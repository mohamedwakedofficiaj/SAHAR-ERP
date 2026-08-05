const { Pool } = require('pg');

// إنشاء الاتصال المباشر بقاعدة البيانات
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

module.exports = pool;
module.exports.pool = pool;
