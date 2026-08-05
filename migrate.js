const path = require('path');
const Module = require('module');

// توجيه تلقائي لأي ملف يبحث عن db/pool
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request.includes('db/pool')) {
    return originalResolve.call(this, path.join(__dirname, 'db', 'pool.js'), parent, isMain, options);
  }
  return originalResolve.call(this, request, parent, isMain, options);
};

const fs = require('fs');
const pool = require('./db/pool');

async function bootstrap() {
  try {
    const schemaPath = path.join(__dirname, 'schema.sql');
    if (fs.existsSync(schemaPath)) {
      const sql = fs.readFileSync(schemaPath, 'utf8');
      await pool.query(sql);
      console.log('Schema applied successfully');
    }
  } catch (err) {
    console.error('Migration notice:', err.message);
  }
}

if (process.env.RUN_SETUP === 'true') {
  bootstrap();
}

module.exports = { bootstrap };
