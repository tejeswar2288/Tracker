// ============================================
//  PROJECT ROUTES — CRUD Operations
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

// GET /api/projects — List projects visible to current user
router.get('/', async (request, response) => {
    try {
        const userId = request.session.userId;
        const userRole = request.session.userRole;

        let result;
        if (userRole === 'admin') {
            // Admin sees all projects
            result = await pool.query(
                'SELECT * FROM projects WHERE deleted_at IS NULL ORDER BY created_at DESC'
            );
        } else {
            // Managers see only their projects
            result = await pool.query(
                `SELECT projects.* FROM projects
                 JOIN project_managers ON project_managers.project_id = projects.id
                 WHERE project_managers.user_id = $1 AND projects.deleted_at IS NULL
                 ORDER BY projects.created_at DESC`,
                [userId]
            );
        }

        // For each project, get managers and task stats
        const projects = [];
        for (const project of result.rows) {
            const managersResult = await pool.query(
                `SELECT users.id, users.name FROM users
                 JOIN project_managers ON project_managers.user_id = users.id
                 WHERE project_managers.project_id = $1 AND users.deleted_at IS NULL`,
                [project.id]
            );

            const statsResult = await pool.query(
                `SELECT
                    COUNT(*) AS total_tasks,
                    COUNT(*) FILTER (WHERE status = 'done') AS completed_tasks,
                    COUNT(*) FILTER (WHERE status != 'done' AND deadline < CURRENT_DATE) AS overdue_tasks,
                    COUNT(*) FILTER (WHERE status != 'done' AND deadline BETWEEN CURRENT_DATE AND CURRENT_DATE + 7) AS due_this_week
                 FROM tasks WHERE project_id = $1 AND deleted_at IS NULL`,
                [project.id]
            );

            const stats = statsResult.rows[0];
            const totalTasks = parseInt(stats.total_tasks) || 0;
            const completedTasks = parseInt(stats.completed_tasks) || 0;

            projects.push({
                ...project,
                managers: managersResult.rows,
                total_tasks: totalTasks,
                completed_tasks: completedTasks,
                overdue_tasks: parseInt(stats.overdue_tasks) || 0,
                due_this_week: parseInt(stats.due_this_week) || 0,
                progress_percentage: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0
            });
        }

        response.json(projects);
    } catch (error) {
        console.error('Error fetching projects:', error);
        response.status(500).json({ error: 'Failed to fetch projects' });
    }
});

// GET /api/projects/:id — Get single project with details
router.get('/:id', async (request, response) => {
    try {
        const result = await pool.query(
            'SELECT * FROM projects WHERE id = $1 AND deleted_at IS NULL',
            [request.params.id]
        );
        if (result.rows.length === 0) {
            return response.status(404).json({ error: 'Project not found' });
        }
        response.json(result.rows[0]);
    } catch (error) {
        console.error('Error fetching project:', error);
        response.status(500).json({ error: 'Failed to fetch project' });
    }
});

// POST /api/projects — Create new project
router.post('/', async (request, response) => {
    const client = await pool.connect();
    try {
        const { name, description, color_index, manager_ids } = request.body;
        const createdBy = request.session.userId;

        if (!name || !name.trim()) {
            return response.status(400).json({ error: 'Project name is required' });
        }

        await client.query('BEGIN');

        // Create the project (trigger will auto-add creator as manager and promote doer)
        const projectResult = await client.query(
            `INSERT INTO projects (name, description, color_index, created_by)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [name.trim(), description || '', color_index ?? 0, createdBy]
        );
        const project = projectResult.rows[0];

        // Add additional managers (if provided)
        if (manager_ids && manager_ids.length > 0) {
            for (const managerId of manager_ids) {
                await client.query(
                    `INSERT INTO project_managers (project_id, user_id)
                     VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                    [project.id, managerId]
                );
            }
        }

        await client.query('COMMIT');

        // Re-read session role (doer may have been promoted to manager)
        const updatedUser = await pool.query('SELECT role FROM users WHERE id = $1', [createdBy]);
        if (updatedUser.rows.length > 0) {
            request.session.userRole = updatedUser.rows[0].role;
        }
        const managedResult = await pool.query('SELECT project_id FROM project_managers WHERE user_id = $1', [createdBy]);
        request.session.managedProjects = managedResult.rows.map(row => row.project_id);

        response.status(201).json(project);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error creating project:', error);
        response.status(500).json({ error: 'Failed to create project' });
    } finally {
        client.release();
    }
});

// PUT /api/projects/:id — Update project
router.put('/:id', async (request, response) => {
    const client = await pool.connect();
    try {
        const { name, description, manager_ids } = request.body;
        const projectId = request.params.id;

        if (!name || !name.trim()) {
            return response.status(400).json({ error: 'Project name is required' });
        }

        await client.query('BEGIN');

        const result = await client.query(
            `UPDATE projects SET name = $1, description = $2 WHERE id = $3 AND deleted_at IS NULL RETURNING *`,
            [name.trim(), description || '', projectId]
        );

        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return response.status(404).json({ error: 'Project not found' });
        }

        // Update managers: remove old, add new
        if (manager_ids) {
            await client.query('DELETE FROM project_managers WHERE project_id = $1', [projectId]);
            for (const managerId of manager_ids) {
                await client.query(
                    'INSERT INTO project_managers (project_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                    [projectId, managerId]
                );
            }
        }

        await client.query('COMMIT');
        response.json(result.rows[0]);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error updating project:', error);
        response.status(500).json({ error: 'Failed to update project' });
    } finally {
        client.release();
    }
});

// DELETE /api/projects/:id — Soft delete project (admin only)
router.delete('/:id', async (request, response) => {
    try {
        if (request.session.userRole !== 'admin') {
            return response.status(403).json({ error: 'Only admin can delete projects' });
        }

        // Soft delete project and its tasks
        await pool.query('UPDATE tasks SET deleted_at = NOW() WHERE project_id = $1 AND deleted_at IS NULL', [request.params.id]);
        const result = await pool.query(
            'UPDATE projects SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING *',
            [request.params.id]
        );

        if (result.rows.length === 0) {
            return response.status(404).json({ error: 'Project not found' });
        }

        response.json({ message: 'Project deleted', project: result.rows[0] });
    } catch (error) {
        console.error('Error deleting project:', error);
        response.status(500).json({ error: 'Failed to delete project' });
    }
});

module.exports = router;
