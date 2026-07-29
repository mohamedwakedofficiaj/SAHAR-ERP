const pool = require('./pool');
const applySeed = require('./seedLogic');

async function run() {
  try {
    await applySeed(pool);
  } catch (err) {
    console.error('✘ Seed failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
