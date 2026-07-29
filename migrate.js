require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

async function bootstrap() {
  // ---- OPTIONAL one-time setup: if RUN_SETUP=true is set in the environment,
  // apply the database schema and seed data automatically before starting the
  // server. This lets someone with no command-line experience deploy entirely
  // through a hosting provider's web dashboard: set RUN_SETUP=true once, deploy,
  // then remove it (or leave it — running it again is safe to skip; see below). ----
  if (process.env.RUN_SETUP === 'true') {
    console.log('RUN_SETUP=true detected — applying schema and seed data...');
    const pool = require('./db/pool');
    try {
      const { rows } = await pool.query(
        `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'tenants') AS exists`
      );
      if (rows[0].exists) {
        console.log('Schema already applied — skipping setup (this is normal on every restart after the first).');
      } else {
        const schemaSql = fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8');
        await pool.query(schemaSql);
        console.log('✔ Schema applied.');
        await require('./db/seed-inline')(pool);
        console.log('✔ Seed data applied.');
      }
    } catch (err) {
      console.error('✘ RUN_SETUP failed:', err.message);
    }
  }

  const authRoutes = require('./routes/auth.routes');
  const companiesRoutes = require('./routes/companies.routes');
  const reportsRoutes = require('./routes/reports.routes');
  const purchaseOrdersRoutes = require('./routes/purchaseOrders.routes');
  const subcontractorsRoutes = require('./routes/subcontractors.routes');
  const contractsRoutes = require('./routes/contracts.routes');
  const expensesRoutes = require('./routes/expenses.routes');
  const banksRoutes = require('./routes/banks.routes');
  const customersRoutes = require('./routes/customers.routes');
  const suppliersRoutes = require('./routes/suppliers.routes');
  const employeesRoutes = require('./routes/employees.routes');
  const inventoryRoutes = require('./routes/inventory.routes');
  const custodyRoutes = require('./routes/custody.routes');
  const usersRoutes = require('./routes/users.routes');

  const app = express();

  app.use(helmet({
    contentSecurityPolicy: false, // relaxed so the bundled static frontend can load without extra CSP configuration
  }));
  app.use(cors({
    origin: (process.env.CORS_ORIGINS || '').split(',').filter(Boolean),
    credentials: true,
  }));
  app.use(express.json());

  // Basic rate limiting on the login endpoint to slow down credential-stuffing attempts
  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
  app.use('/api/auth/login', loginLimiter);

  app.use('/api/auth', authRoutes);
  app.use('/api/companies', companiesRoutes);
  app.use('/api/reports', reportsRoutes);
  app.use('/api/purchase-orders', purchaseOrdersRoutes);
  app.use('/api/subcontractors', subcontractorsRoutes);
  app.use('/api/contracts', contractsRoutes); // also exposes /api/contracts/installments/:id/collect
  app.use('/api/expenses', expensesRoutes);
  app.use('/api/banks', banksRoutes);
  app.use('/api/customers', customersRoutes);
  app.use('/api/suppliers', suppliersRoutes);
  app.use('/api/employees', employeesRoutes);
  app.use('/api/inventory', inventoryRoutes);
  app.use('/api/custody', custodyRoutes);
  app.use('/api/users', usersRoutes);

  app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

  // ---- serve the frontend as static files, so ONE deployment gives you both the
  // API and the web interface at the same address (simpler to host and to explain) ----
  const PUBLIC_DIR = path.join(__dirname, '..', 'public');
  app.use(express.static(PUBLIC_DIR));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next(); // let unmatched API routes fall through to the 404 handler below
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'), (err) => {
      if (err) next();
    });
  });

  app.use((req, res) => res.status(404).json({ error: 'Not found' }));

  // Centralized error handler (so route handlers can just `throw` and get a clean JSON response)
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'حدث خطأ غير متوقع في الخادم.' });
  });

  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => {
    console.log(`✔ Al-Wisam ERP API running on http://localhost:${PORT}`);
  });
}

bootstrap();
