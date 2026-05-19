// ============================================
//  ROLE CAPABILITIES ROUTES — RBAC Configuration
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

// GET /api/role-capabilities — Get all role capabilities
router.get('/', async (request, response) => {
    try {
        const result = await pool.query('SELECT * FROM role_capabilities ORDER BY role');
        response.json(result.rows);
    } catch (error) {
        console.error('Error fetching role capabilities:', error);
        response.status(500).json({ error: 'Failed to fetch role capabilities' });
    }
});

// PUT /api/role-capabilities/:role — Update capabilities for a role (admin only)
router.put('/:role', async (request, response) => {
    try {
        if (request.session.userRole !== 'admin') {
            return response.status(403).json({ error: 'Only admin can change role capabilities' });
        }

        const role = request.params.role;
        const capabilities = request.body;

        const result = await pool.query(
            `UPDATE role_capabilities SET
                view_all_projects = $1,
                create_projects = $2,
                edit_own_projects = $3,
                view_own_projects = $4,
                assign_tasks = $5,
                add_comments = $6,
                delete_projects = $7,
                delete_tasks = $8
             WHERE role = $9 RETURNING *`,
            [
                capabilities.view_all_projects || false,
                capabilities.create_projects || false,
                capabilities.edit_own_projects || false,
                capabilities.view_own_projects || false,
                capabilities.assign_tasks || false,
                capabilities.add_comments || false,
                capabilities.delete_projects || false,
                capabilities.delete_tasks || false,
                role
            ]
        );

        if (result.rows.length === 0) {
            return response.status(404).json({ error: 'Role not found' });
        }

        response.json(result.rows[0]);
    } catch (error) {
        console.error('Error updating role capabilities:', error);
        response.status(500).json({ error: 'Failed to update role capabilities' });
    }
});

module.exports = router;
