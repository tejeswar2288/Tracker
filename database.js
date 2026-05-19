// ============================================
//  DATABASE CONNECTION POOL
//  Connects to PostgreSQL (local or AWS RDS)
// ============================================

const { Pool, types } = require('pg');

// Return DATE (OID 1082) and TIMESTAMP (OID 1114) as raw strings
// instead of JS Date objects — prevents timezone shift issues
// (e.g., IST midnight → UTC serialization losing 1 day)
types.setTypeParser(1082, val => val);           // DATE → "2026-03-28"
types.setTypeParser(1114, val => val);           // TIMESTAMP WITHOUT TZ
types.setTypeParser(1184, val => val);           // TIMESTAMPTZ

const pool = new Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: { rejectUnauthorized: false },   // required for AWS RDS
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
});

// Test connection on startup
pool.query('SELECT NOW()')
    .then(() => console.log('✅ Connected to PostgreSQL'))
    .catch(error => console.error('❌ Database connection failed:', error.message));

module.exports = pool;
