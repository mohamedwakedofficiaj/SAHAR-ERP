require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

async function bootstrap() {
  if (process.env.RUN_SETUP === 'true') {
    console.log('RUN_SETUP=true detected - applying schema and seed data...');
    try {
      // الاتصال بقاعدة البيانات من المجلد الرئيسي مباشرة
      const pool = require('./pool');
      
      const { rows } = await pool.query(
        `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'tenants') AS exists`
      );
      
      if (rows && rows[0] && rows[0].exists) {
        console.log('Schema already applied – skipping setup.');
      } else {
        // قراءة ملف schema.sql من المجلد الرئيسي
        const schemaPath = path.join(__dirname, 'schema.sql');
        if (fs.existsSync(schemaPath)) {
          const schemaSql = fs.readFileSync(schemaPath, 'utf8');
          await pool.query(schemaSql);
          console.log('✓ Schema applied.');
        }

        // تشغيل بيانات البداية إذا كان الملف موجوداً
        const seedPath = path.join(__dirname, 'seed.js');
        if (fs.existsSync(seedPath)) {
          const seed = require('./seed');
          if (typeof seed === 'function') {
            await seed(pool);
          }
          console.log('✓ Seed data applied.');
        }
      }
    } catch (err) {
      console.error('X RUN_SETUP failed:', err.message);
    }
  }
}

// استدعاء دالة التهيئة
bootstrap();

// استدعاء المسارات من المجلد الرئيسي مباشرة بدون مجلد routes
const authRoutes = require('./auth.routes');
const companiesRoutes = require('./companies.routes');
const purchaseOrdersRoutes = require('./purchaseOrders.routes');
const customersRoutes = require('./customers.routes');
const suppliersRoutes = require('./suppliers.routes');
const employeesRoutes = require('./employees.routes');
const expensesRoutes = require('./expenses.routes');
const inventoryRoutes = require('./inventory.routes');
const contractsRoutes = require('./contracts.routes');
const subcontractorsRoutes = require('./subcontractors.routes');
const banksRoutes = require('./banks.routes');
const usersRoutes = require('./users.routes');

module.exports = {
  bootstrap,
  authRoutes,
  companiesRoutes,
  purchaseOrdersRoutes,
  customersRoutes,
  suppliersRoutes,
  employeesRoutes,
  expensesRoutes,
  inventoryRoutes,
  contractsRoutes,
  subcontractorsRoutes,
  banksRoutes,
  usersRoutes
};
