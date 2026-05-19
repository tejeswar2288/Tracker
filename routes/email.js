// ============================================
//  EMAIL ROUTE — POST /api/tasks/:id/send-reminder
// ============================================

const express = require('express');
const router  = express.Router({ mergeParams: true });
const pool    = require('../database');
const { sendTaskReminder } = require('../services/email');

function requireLogin(req, res, next) {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    next();
}
router.use(requireLogin);

// POST /api/tasks/:id/send-reminder
router.post('/', async (req, res) => {
    const { id: taskId } = req.params;
    const { custom_message } = req.body;

    try {
        // ── Fetch task with project and assignees ──
        const taskResult = await pool.query(
            `SELECT t.*,
                p.name AS project_name,
                STRING_AGG(DISTINCT u.name, ' / ' ORDER BY u.name) AS assignees
             FROM tasks t
             JOIN projects p ON p.id = t.project_id
             LEFT JOIN task_assignees ta ON ta.task_id = t.id
             LEFT JOIN users u ON u.id = ta.user_id AND u.deleted_at IS NULL
             WHERE t.id = $1 AND t.deleted_at IS NULL
             GROUP BY t.id, p.id`,
            [taskId]
        );

        if (taskResult.rows.length === 0) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const task = taskResult.rows[0];

        // ── Fetch assignee emails ──
        const assigneeResult = await pool.query(
            `SELECT u.name, u.email
             FROM task_assignees ta
             JOIN users u ON u.id = ta.user_id AND u.deleted_at IS NULL
             WHERE ta.task_id = $1 AND u.email IS NOT NULL AND u.email <> ''`,
            [taskId]
        );

        if (assigneeResult.rows.length === 0) {
            return res.status(400).json({
                error: 'No assignees with email addresses found. Please add email addresses to users first.'
            });
        }

        const assigneeEmails = assigneeResult.rows.map(r => r.email);
        const assigneeNames  = assigneeResult.rows.map(r => r.name);

        // ── Get sender name ──
        const senderResult = await pool.query(
            'SELECT name FROM users WHERE id = $1',
            [req.session.userId]
        );
        const senderName = senderResult.rows[0]?.name || 'Task Tracker';

        // ── Send the email ──
        await sendTaskReminder({
            task: { ...task, action_steps: task.action_steps },
            project: { name: task.project_name },
            assigneeEmails,
            assigneeNames,
            senderName,
            customMessage: custom_message || '',
        });

        res.json({
            success: true,
            message: `Reminder sent to ${assigneeNames.join(', ')}`,
            recipients: assigneeEmails,
        });

    } catch (error) {
        console.error('Email send error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
