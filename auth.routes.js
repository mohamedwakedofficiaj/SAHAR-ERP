// Thin re-export used by server.js's boot-time auto-setup (RUN_SETUP=true).
// The server owns the pool's lifecycle, so this does NOT end the pool.
module.exports = require('./seedLogic');
