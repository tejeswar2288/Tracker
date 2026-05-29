// ============================================
//  AUTH ROUTES — Login / Logout / Session
//  Role resolved from normalized role tables:
//  admins, user_managers, user_doers
// ============================================

const express = require('express');
const router = express.Router();
const pool = require('../database');

// Helper: resolve effective role from normalized tables
// Priority: admin > manager > doer
async function getEffectiveRole(userId) {
    const result = await pool.query(`
        SELECT
            CASE
                WHEN a.user_id IS NOT NULL THEN 'admin'
                WHEN m.user_id IS NOT NULL THEN 'manager'
                ELSE 'doer'
            END AS effective_role
        FROM users u
        LEFT JOIN admins        a ON a.user_id = u.id
        LEFT JOIN user_managers m ON m.user_id = u.id
        WHERE u.id = $1
    `, [userId]);
    return result.rows[0]?.effective_role || 'doer';
}

// GET /api/auth/people — All users for login dropdown with effective role
router.get('/people', async (request, response) => {
    try {
        const result = await pool.query(`
            SELECT
                u.id,
                u.name,
                u.email,
                CASE
                    WHEN a.user_id IS NOT NULL THEN 'admin'
                    WHEN m.user_id IS NOT NULL THEN 'manager'
                    ELSE 'doer'
                END AS role,
                -- Is this person also in user_doers? (dual role)
                CASE WHEN d.user_id IS NOT NULL THEN true ELSE false END AS is_doer
            FROM users u
            LEFT JOIN admins        a ON a.user_id = u.id
            LEFT JOIN user_managers m ON m.user_id = u.id
            LEFT JOIN user_doers    d ON d.user_id = u.id
            WHERE u.deleted_at IS NULL
            ORDER BY
                CASE
                    WHEN a.user_id IS NOT NULL THEN 0
                    WHEN m.user_id IS NOT NULL THEN 1
                    ELSE 2
                END,
                u.name
        `);
        response.json(result.rows);
    } catch (error) {
        console.error('Error fetching people:', error);
        response.status(500).json({ error: 'Failed to fetch users' });
    }
});

// POST /api/auth/login — Login by email + password
router.post('/login', async (request, response) => {
    try {
        const { email, password } = request.body;
        if (!email || !password) {
            return response.status(400).json({ error: 'Email and password are required' });
        }

        // Find the user by email
        const userResult = await pool.query(
            'SELECT id, name, email, password_hash FROM users WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL',
            [email]
        );

        if (userResult.rows.length === 0) {
            return response.status(401).json({ error: 'Invalid email or password' });
        }

        const user = userResult.rows[0];

        // Verify password with bcrypt
        if (!user.password_hash) {
            return response.status(401).json({ error: 'No password set for this account. Contact admin.' });
        }

        const bcrypt = require('bcrypt');
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return response.status(401).json({ error: 'Invalid email or password' });
        }

        // Resolve effective role from normalized role tables
        const roleResult = await pool.query(`
            SELECT
                CASE
                    WHEN a.user_id IS NOT NULL THEN 'admin'
                    WHEN m.user_id IS NOT NULL THEN 'manager'
                    ELSE 'doer'
                END AS role,
                CASE WHEN d.user_id IS NOT NULL THEN true ELSE false END AS is_doer
            FROM users u
            LEFT JOIN admins        a ON a.user_id = u.id
            LEFT JOIN user_managers m ON m.user_id = u.id
            LEFT JOIN user_doers    d ON d.user_id = u.id
            WHERE u.id = $1
        `, [user.id]);

        const effectiveRole = roleResult.rows[0]?.role || 'doer';
        const isDoer = roleResult.rows[0]?.is_doer || false;

        // Get managed projects for this user
        const managedProjectsResult = await pool.query(
            'SELECT project_id FROM project_managers WHERE user_id = $1',
            [user.id]
        );
        const managedProjects = managedProjectsResult.rows.map(row => row.project_id);

        // Store in session
        request.session.userId = user.id;
        request.session.userName = user.name;
        request.session.userRole = effectiveRole;
        request.session.isDoer = isDoer;
        request.session.managedProjects = managedProjects;

        response.json({
            id: user.id,
            name: user.name,
            email: user.email,
            role: effectiveRole,
            is_doer: isDoer,
            managedProjects
        });
    } catch (error) {
        console.error('Error during login:', error);
        response.status(500).json({ error: 'Login failed' });
    }
});

// POST /api/auth/logout
router.post('/logout', (request, response) => {
    request.session.destroy();
    response.json({ message: 'Logged out' });
});

// GET /api/auth/me — Get current session user
router.get('/me', (request, response) => {
    if (!request.session.userId) {
        return response.status(401).json({ error: 'Not logged in' });
    }
    response.json({
        id: request.session.userId,
        name: request.session.userName,
        role: request.session.userRole,
        is_doer: request.session.isDoer || false,
        managedProjects: request.session.managedProjects
    });
});

module.exports = router;
