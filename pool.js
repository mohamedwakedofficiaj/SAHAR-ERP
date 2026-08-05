const { Pool } = require('pg');
require('dotenv').config();

// إلغاء تشفير SSL إذا كان الاتصال داخلياً على Railway
const isRailway = process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway.internal');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isRailway ? false : (process.env.DATABASE_URL ? { rejectUnauthorized: false } : false)
});

module.exports = pool;
