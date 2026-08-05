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

const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

try {
  require('./migrate');
} catch (e) {
  console.log('Migrate status:', e.message);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
