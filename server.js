// ============================================
//  WWW TASK TRACKER — Express Server
//  Connects the HTML frontend to PostgreSQL
// ============================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ──
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session management (in-memory for practice; use a store like connect-pg-simple for production)
app.use(session({
    secret: 'www-tracker-practice-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,       // set to true when using HTTPS in production
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000  // 24 hours
    }
}));

// Serve the HTML frontend from the "public" folder
// Explicitly set UTF-8 charset so browser never misreads encoding
app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.js'))   res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        if (filePath.endsWith('.html')) res.setHeader('Content-Type', 'text/html; charset=utf-8');
        if (filePath.endsWith('.css'))  res.setHeader('Content-Type', 'text/css; charset=utf-8');
    }
}));


// ── API Routes ──
app.use('/api/auth', require('./routes/auth'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/tasks/:id/send-reminder', require('./routes/email'));
app.use('/api/users', require('./routes/users'));
app.use('/api/role-capabilities', require('./routes/role_capabilities'));

// Bootstrap endpoint — only works when users table is empty (fresh DB)
// Used by migrate.html to seed initial users without needing login
app.post('/api/bootstrap/user', async (request, response) => {
    const pool = require('./database');
    try {
        // Only allow if DB is empty
        const count = await pool.query('SELECT COUNT(*) FROM users WHERE deleted_at IS NULL');
        const isEmpty = parseInt(count.rows[0].count) === 0;
        const { name, email, role } = request.body;

        // After first user created, allow more only in same bootstrap session
        if (!isEmpty && !request.session.bootstrapping) {
            return response.status(403).json({ error: 'Bootstrap only allowed on empty database' });
        }

        if (!name || !name.trim()) return response.status(400).json({ error: 'Name required' });

        // Mark bootstrap session
        request.session.bootstrapping = true;

        const existing = await pool.query(
            'SELECT id, name, role FROM users WHERE LOWER(name) = LOWER($1) AND deleted_at IS NULL', [name.trim()]
        );
        if (existing.rows.length > 0) return response.json(existing.rows[0]);

        const result = await pool.query(
            'INSERT INTO users (name, email, role) VALUES ($1, $2, $3) RETURNING *',
            [name.trim(), email || null, role || 'doer']
        );

        // Auto-add admin to admins table
        if (role === 'admin') {
            await pool.query(
                'INSERT INTO admins (user_id) VALUES ($1) ON CONFLICT DO NOTHING',
                [result.rows[0].id]
            );
        }

        response.status(201).json(result.rows[0]);
    } catch (error) {
        response.status(500).json({ error: error.message });
    }
});

// Health check endpoint
app.get('/api/health', async (request, response) => {
    const pool = require('./database');
    try {
        const result = await pool.query('SELECT NOW() AS server_time');
        response.json({
            status: 'healthy',
            server_time: result.rows[0].server_time,
            database: 'connected'
        });
    } catch (error) {
        response.status(500).json({
            status: 'unhealthy',
            database: 'disconnected',
            error: error.message
        });
    }
});

// Fallback: serve index.html for any non-API route
app.get('/{*splat}', (request, response) => {
    response.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start Server ──
app.listen(PORT, () => {
    console.log(`\n🚀 WWW Task Tracker server running at http://localhost:${PORT}`);
    console.log(`📁 Serving frontend from ./public/`);
    console.log(`🔌 API available at http://localhost:${PORT}/api/\n`);
});
