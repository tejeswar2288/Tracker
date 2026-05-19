// ============================================
//  USER ROUTES — CRUD Operations (Admin Only)
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

// Middleware: require admin role
function requireAdmin(request, response, next) {
    if (request.session.userRole !== 'admin') {
        return response.status(403).json({ error: 'Only admin can manage users' });
    }
    next();
}

async function syncRoleMembership(client, userId, role, changedBy = null) {
    await client.query('DELETE FROM admins WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM user_managers WHERE user_id = $1', [userId]);

    if (role === 'admin') {
        await client.query(
            'INSERT INTO admins (user_id, granted_by) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING',
            [userId, changedBy]
        );
    }

    if (role === 'manager') {
        await client.query(
            'INSERT INTO user_managers (user_id, promoted_by) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING',
            [userId, changedBy]
        );
    }
}

router.use(requireLogin);

// GET /api/users — List all users
router.get('/', async (request, response) => {
    try {
        const result = await pool.query(
            'SELECT id, name, email, role, created_at FROM users WHERE deleted_at IS NULL ORDER BY name'
        );
        response.json(result.rows);
    } catch (error) {
        console.error('Error fetching users:', error);
        response.status(500).json({ error: 'Failed to fetch users' });
    }
});

// POST /api/users — Create new user (admin only)
router.post('/', requireAdmin, async (request, response) => {
    const client = await pool.connect();
    try {
        const { name, email, role, project_id } = request.body;
        const effectiveRole = project_id ? 'manager' : (role || 'doer');

        if (!name || !name.trim()) {
            return response.status(400).json({ error: 'User name is required' });
        }

        // Check name uniqueness
        const existingName = await client.query(
            'SELECT id FROM users WHERE LOWER(name) = LOWER($1) AND deleted_at IS NULL',
            [name.trim()]
        );
        if (existingName.rows.length > 0) {
            return response.status(409).json({ error: 'User name already exists' });
        }

        // Check email uniqueness (if provided)
        if (email && email.trim()) {
            const existingEmail = await client.query(
                'SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL',
                [email.trim()]
            );
            if (existingEmail.rows.length > 0) {
                return response.status(409).json({ error: 'Email already exists' });
            }
        }

        await client.query('BEGIN');

        const result = await client.query(
            `INSERT INTO users (name, email, role) VALUES ($1, $2, $3) RETURNING *`,
            [name.trim(), email ? email.trim().toLowerCase() : null, effectiveRole]
        );

        const newUser = result.rows[0];
        await syncRoleMembership(client, newUser.id, effectiveRole, request.session.userId);

        // If project_id provided, add user as project manager
        if (project_id) {
            await client.query(
                'INSERT INTO project_managers (project_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [project_id, newUser.id]
            );
        }

        await client.query('COMMIT');
        response.status(201).json(newUser);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error creating user:', error);
        response.status(500).json({ error: 'Failed to create user' });
    } finally {
        client.release();
    }
});

// PUT /api/users/:id — Update user (admin only)
router.put('/:id', requireAdmin, async (request, response) => {
    const client = await pool.connect();
    try {
        const { name, email, role } = request.body;
        const userId = request.params.id;
        const effectiveRole = role || 'doer';

        if (!name || !name.trim()) {
            return response.status(400).json({ error: 'User name is required' });
        }

        await client.query('BEGIN');

        const result = await client.query(
            `UPDATE users SET name = $1, email = $2, role = $3 WHERE id = $4 AND deleted_at IS NULL RETURNING *`,
            [name.trim(), email ? email.trim().toLowerCase() : null, effectiveRole, userId]
        );

        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return response.status(404).json({ error: 'User not found' });
        }

        await syncRoleMembership(client, userId, effectiveRole, request.session.userId);

        await client.query('COMMIT');
        response.json(result.rows[0]);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error updating user:', error);
        response.status(500).json({ error: 'Failed to update user' });
    } finally {
        client.release();
    }
});

// DELETE /api/users/:id — Soft delete user (admin only)
router.delete('/:id', requireAdmin, async (request, response) => {
    try {
        const result = await pool.query(
            'UPDATE users SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING *',
            [request.params.id]
        );

        if (result.rows.length === 0) {
            return response.status(404).json({ error: 'User not found' });
        }

        response.json({ message: 'User deleted', user: result.rows[0] });
    } catch (error) {
        console.error('Error deleting user:', error);
        response.status(500).json({ error: 'Failed to delete user' });
    }
});

module.exports = router;
