// ============================================
//  TASK ROUTES — CRUD, Status, Priority, Comments
// ============================================

const express = require('express');
const router = express.Router();
const pool = require('../database');

// Middleware: require login
function requireLogin(request, response, next) {
    if (!request.session.userId) {
        return response.status(401).json({ error: 'Not logged in' });
    }
    next();
}

router.use(requireLogin);

// GET /api/tasks?project_id=xxx — List tasks for a project
router.get('/', async (request, response) => {
    try {
        const { project_id, status, search, assignee_id } = request.query;

        let query = `
            SELECT tasks.*,
                STRING_AGG(DISTINCT users.name, ' / ' ORDER BY users.name) AS assignees,
                (SELECT c.body
                 FROM comments c
                 WHERE c.task_id = tasks.id AND c.deleted_at IS NULL
                 ORDER BY c.created_at DESC
                 LIMIT 1
                ) AS task_comments
            FROM tasks
            LEFT JOIN task_assignees ON task_assignees.task_id = tasks.id
            LEFT JOIN users ON users.id = task_assignees.user_id AND users.deleted_at IS NULL
            WHERE tasks.deleted_at IS NULL
        `;
        const params = [];
        let paramIndex = 1;

        if (project_id) {
            query += ` AND tasks.project_id = $${paramIndex++}`;
            params.push(project_id);
        }

        if (status) {
            query += ` AND tasks.status = $${paramIndex++}`;
            params.push(status);
        }

        if (search) {
            query += ` AND (tasks.activity ILIKE $${paramIndex} OR tasks.action_steps ILIKE $${paramIndex} OR tasks.support_needed ILIKE $${paramIndex})`;
            params.push(`%${search}%`);
            paramIndex++;
        }

        if (assignee_id) {
            query += ` AND tasks.id IN (SELECT task_id FROM task_assignees WHERE user_id = $${paramIndex++})`;
            params.push(assignee_id);
        }

        query += ' GROUP BY tasks.id ORDER BY tasks.created_at ASC';

        const result = await pool.query(query, params);
        response.json(result.rows);
    } catch (error) {
        console.error('Error fetching tasks:', error);
        response.status(500).json({ error: 'Failed to fetch tasks' });
    }
});

// GET /api/tasks/my-tasks — Get tasks assigned to current user
router.get('/my-tasks', async (request, response) => {
    try {
        const userId = request.session.userId;

        const result = await pool.query(
            `SELECT tasks.*,
                projects.name AS project_name,
                STRING_AGG(DISTINCT all_assignees.name, ' / ' ORDER BY all_assignees.name) AS assignees,
                (SELECT c.body
                 FROM comments c
                 WHERE c.task_id = tasks.id AND c.deleted_at IS NULL
                 ORDER BY c.created_at DESC
                 LIMIT 1
                ) AS task_comments
             FROM task_assignees
             JOIN tasks ON tasks.id = task_assignees.task_id AND tasks.deleted_at IS NULL
             JOIN projects ON projects.id = tasks.project_id AND projects.deleted_at IS NULL
             LEFT JOIN task_assignees all_task_assignees ON all_task_assignees.task_id = tasks.id
             LEFT JOIN users all_assignees ON all_assignees.id = all_task_assignees.user_id AND all_assignees.deleted_at IS NULL
             WHERE task_assignees.user_id = $1
             GROUP BY tasks.id, projects.id
             ORDER BY tasks.created_at ASC`,
            [userId]
        );

        response.json(result.rows);
    } catch (error) {
        console.error('Error fetching my tasks:', error);
        response.status(500).json({ error: 'Failed to fetch tasks' });
    }
});

// GET /api/tasks/:id — Get single task with assignees and history
router.get('/:id', async (request, response) => {
    try {
        const taskResult = await pool.query(
            'SELECT * FROM tasks WHERE id = $1 AND deleted_at IS NULL',
            [request.params.id]
        );
        if (taskResult.rows.length === 0) {
            return response.status(404).json({ error: 'Task not found' });
        }

        const task = taskResult.rows[0];

        // Get assignees
        const assigneesResult = await pool.query(
            `SELECT users.id, users.name FROM users
             JOIN task_assignees ON task_assignees.user_id = users.id
             WHERE task_assignees.task_id = $1 AND users.deleted_at IS NULL`,
            [task.id]
        );

        // Get history
        const historyResult = await pool.query(
            `SELECT task_history.*, users.name AS changed_by_name
             FROM task_history
             LEFT JOIN users ON users.id = task_history.changed_by
             WHERE task_history.task_id = $1
             ORDER BY task_history.changed_at DESC`,
            [task.id]
        );

        // Get comments
        const commentsResult = await pool.query(
            `SELECT comments.*, users.name AS author_name
             FROM comments
             LEFT JOIN users ON users.id = comments.author_id
             WHERE comments.task_id = $1 AND comments.deleted_at IS NULL
             ORDER BY comments.created_at DESC`,
            [task.id]
        );

        response.json({
            ...task,
            assignees: assigneesResult.rows.map(u => u.name).join(' / '),
            assignee_ids: assigneesResult.rows.map(u => u.id),
            history: historyResult.rows,
            comments: commentsResult.rows
        });
    } catch (error) {
        console.error('Error fetching task:', error);
        response.status(500).json({ error: 'Failed to fetch task' });
    }
});

// POST /api/tasks — Create new task
router.post('/', async (request, response) => {
    const client = await pool.connect();
    try {
        const { project_id, activity, action_steps, priority, deadline, status, support_needed, assignee_ids } = request.body;

        if (!activity || !activity.trim()) {
            return response.status(400).json({ error: 'Task activity name is required' });
        }
        if (!project_id) {
            return response.status(400).json({ error: 'Project ID is required' });
        }

        await client.query('BEGIN');

        const taskResult = await client.query(
            `INSERT INTO tasks (project_id, activity, action_steps, priority, deadline, status, support_needed, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [project_id, activity.trim(), action_steps || '', priority || 'medium', deadline || null, status || 'pending', support_needed || '', request.session.userId]
        );
        const task = taskResult.rows[0];

        // Add assignees
        if (assignee_ids && assignee_ids.length > 0) {
            for (const assigneeId of assignee_ids) {
                await client.query(
                    'INSERT INTO task_assignees (task_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                    [task.id, assigneeId]
                );
            }
        }

        await client.query('COMMIT');
        response.status(201).json(task);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error creating task:', error);
        response.status(500).json({ error: 'Failed to create task' });
    } finally {
        client.release();
    }
});

// PUT /api/tasks/:id — Update task
router.put('/:id', async (request, response) => {
    const client = await pool.connect();
    try {
        const { activity, action_steps, priority, deadline, status, support_needed, assignee_ids } = request.body;
        const taskId = request.params.id;

        console.log(`[PUT /tasks/${taskId}] deadline received:`, JSON.stringify(deadline), 'type:', typeof deadline);

        if (!activity || !activity.trim()) {
            return response.status(400).json({ error: 'Task activity name is required' });
        }

        await client.query('BEGIN');

        const result = await client.query(
            `UPDATE tasks SET activity = $1, action_steps = $2, priority = $3, deadline = $4, status = $5, support_needed = $6
             WHERE id = $7 AND deleted_at IS NULL RETURNING *`,
            [activity.trim(), action_steps || '', priority || 'medium', deadline || null, status || 'pending', support_needed || '', taskId]
        );

        console.log(`[PUT /tasks/${taskId}] updated deadline in DB:`, result.rows[0]?.deadline);

        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return response.status(404).json({ error: 'Task not found' });
        }

        // Update assignees
        if (assignee_ids) {
            await client.query('DELETE FROM task_assignees WHERE task_id = $1', [taskId]);
            for (const assigneeId of assignee_ids) {
                await client.query(
                    'INSERT INTO task_assignees (task_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                    [taskId, assigneeId]
                );
            }
        }

        await client.query('COMMIT');
        response.json(result.rows[0]);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error updating task:', error);
        response.status(500).json({ error: 'Failed to update task' });
    } finally {
        client.release();
    }
});

// PUT /api/tasks/:id/status — Change task status (with reason and history)
router.put('/:id/status', async (request, response) => {
    const client = await pool.connect();
    try {
        const { new_status, reason, new_deadline } = request.body;
        const taskId = request.params.id;
        const changedBy = request.session.userId;

        // Get current task
        const currentTask = await client.query(
            'SELECT status, deadline FROM tasks WHERE id = $1 AND deleted_at IS NULL',
            [taskId]
        );
        if (currentTask.rows.length === 0) {
            return response.status(404).json({ error: 'Task not found' });
        }

        const oldStatus = currentTask.rows[0].status;

        await client.query('BEGIN');

        // Insert history entry using correct schema columns
        await client.query(
            `INSERT INTO task_history (task_id, field, old_value, new_value, reason, changed_by)
             VALUES ($1, 'status', $2, $3, $4, $5)`,
            [taskId, oldStatus, new_status, reason || '(no reason given)', changedBy]
        );

        // Log deadline change separately if provided
        if (new_deadline && new_deadline !== currentTask.rows[0].deadline) {
            await client.query(
                `INSERT INTO task_history (task_id, field, old_value, new_value, reason, changed_by)
                 VALUES ($1, 'deadline', $2, $3, 'Deadline updated with status change', $4)`,
                [taskId, currentTask.rows[0].deadline || null, new_deadline, changedBy]
            );
        }

        // Update task status and deadline
        if (new_deadline) {
            await client.query(
                'UPDATE tasks SET status = $1, deadline = $2 WHERE id = $3',
                [new_status, new_deadline, taskId]
            );
        } else {
            await client.query(
                'UPDATE tasks SET status = $1 WHERE id = $2',
                [new_status, taskId]
            );
        }

        await client.query('COMMIT');
        response.json({ message: 'Status updated', from: oldStatus, to: new_status });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error changing status:', error);
        response.status(500).json({ error: 'Failed to change status' });
    } finally {
        client.release();
    }
});

// PUT /api/tasks/:id/priority — Change task priority (with history)
router.put('/:id/priority', async (request, response) => {
    const client = await pool.connect();
    try {
        const { new_priority } = request.body;
        const taskId = request.params.id;
        const changedBy = request.session.userId;

        // Get current priority
        const currentTask = await client.query(
            'SELECT priority FROM tasks WHERE id = $1 AND deleted_at IS NULL',
            [taskId]
        );
        if (currentTask.rows.length === 0) {
            return response.status(404).json({ error: 'Task not found' });
        }

        const oldPriority = currentTask.rows[0].priority;

        await client.query('BEGIN');

        // Update priority in tasks table
        await client.query(
            'UPDATE tasks SET priority = $1, updated_at = NOW() WHERE id = $2',
            [new_priority, taskId]
        );

        // Log change to task_history using correct generic columns (field / old_value / new_value)
        await client.query(
            `INSERT INTO task_history (task_id, field, old_value, new_value, reason, changed_by)
             VALUES ($1, 'priority', $2, $3, 'Priority updated', $4)`,
            [taskId, oldPriority, new_priority, changedBy]
        );

        await client.query('COMMIT');
        response.json({ message: 'Priority updated', from: oldPriority, to: new_priority });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error changing priority:', error);
        response.status(500).json({ error: 'Failed to change priority' });
    } finally {
        client.release();
    }
});

// POST /api/tasks/:id/comments — Add a comment to a task
router.post('/:id/comments', async (request, response) => {
    try {
        const { content } = request.body;
        const taskId = request.params.id;
        const authorId = request.session.userId;

        if (!content || !content.trim()) {
            return response.status(400).json({ error: 'Comment content is required' });
        }

        const result = await pool.query(
            `INSERT INTO comments (task_id, author_id, body)
             VALUES ($1, $2, $3) RETURNING *`,
            [taskId, authorId, content.trim()]
        );

        // Also update the support_needed column so the latest comment reflects there
        await pool.query(
            'UPDATE tasks SET support_needed = $1, updated_at = NOW() WHERE id = $2',
            [content.trim(), taskId]
        );

        response.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error adding comment:', error);
        response.status(500).json({ error: 'Failed to add comment' });
    }
});

// GET /api/tasks/:id/history — Get status/priority change history
router.get('/:id/history', async (request, response) => {
    try {
        const result = await pool.query(
            `SELECT task_history.*, users.name AS changed_by_name
             FROM task_history
             LEFT JOIN users ON users.id = task_history.changed_by
             WHERE task_history.task_id = $1
             ORDER BY task_history.changed_at DESC`,
            [request.params.id]
        );
        response.json(result.rows);
    } catch (error) {
        console.error('Error fetching history:', error);
        response.status(500).json({ error: 'Failed to fetch history' });
    }
});

// GET /api/tasks/:id/comments — Get comments for a task
router.get('/:id/comments', async (request, response) => {
    try {
        const result = await pool.query(
            `SELECT comments.*, users.name AS author_name
             FROM comments
             LEFT JOIN users ON users.id = comments.author_id
             WHERE comments.task_id = $1 AND comments.deleted_at IS NULL
             ORDER BY comments.created_at DESC`,
            [request.params.id]
        );
        response.json(result.rows);
    } catch (error) {
        console.error('Error fetching comments:', error);
        response.status(500).json({ error: 'Failed to fetch comments' });
    }
});

// DELETE /api/tasks/:taskId/comments/:commentId — Soft delete a comment
router.delete('/:taskId/comments/:commentId', async (request, response) => {
    try {
        const { taskId, commentId } = request.params;

        const result = await pool.query(
            'UPDATE comments SET deleted_at = NOW() WHERE id = $1 AND task_id = $2 AND deleted_at IS NULL RETURNING *',
            [commentId, taskId]
        );

        if (result.rows.length === 0) {
            return response.status(404).json({ error: 'Comment not found' });
        }

        response.json({ message: 'Comment deleted' });
    } catch (error) {
        console.error('Error deleting comment:', error);
        response.status(500).json({ error: 'Failed to delete comment' });
    }
});

// DELETE /api/tasks/:id — Soft delete task (admin only)
router.delete('/:id', async (request, response) => {
    try {
        if (request.session.userRole !== 'admin') {
            return response.status(403).json({ error: 'Only admin can delete tasks' });
        }

        const result = await pool.query(
            'UPDATE tasks SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING *',
            [request.params.id]
        );

        if (result.rows.length === 0) {
            return response.status(404).json({ error: 'Task not found' });
        }

        response.json({ message: 'Task deleted', task: result.rows[0] });
    } catch (error) {
        console.error('Error deleting task:', error);
        response.status(500).json({ error: 'Failed to delete task' });
    }
});

module.exports = router;
