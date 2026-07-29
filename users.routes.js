const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requireCompanyAccess } = require('../middleware/companyScope');

const router = express.Router();
router.use(requireAuth);

// GET /api/customers?company_id=...
router.get('/', requireCompanyAccess, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT c.*, vb.balance
     FROM customers c
     LEFT JOIN v_customer_balance vb ON vb.customer_id = c.id
     WHERE c.company_id = $1
     ORDER BY c.name`,
    [req.companyId]
  );
  res.json(rows);
});

// POST /api/customers  { company_id, name, phone }
router.post('/', requireCompanyAccess, async (req, res) => {
  const { name, phone } = req.body;
  if (!name) return res.status(400).json({ error: 'اسم العميل مطلوب.' });
  const { rows: [customer] } = await pool.query(
    `INSERT INTO customers (company_id, name, phone) VALUES ($1,$2,$3) RETURNING *`,
    [req.companyId, name, phone || null]
  );
  res.status(201).json(customer);
});

// PUT /api/customers/:id  { name, phone }
router.put('/:id', async (req, res) => {
  const { name, phone } = req.body;
  const { rows: [customer] } = await pool.query(
    `UPDATE customers SET name = COALESCE($1,name), phone = COALESCE($2,phone) WHERE id = $3 RETURNING *`,
    [name, phone, req.params.id]
  );
  if (!customer) return res.status(404).json({ error: 'العميل غير موجود.' });
  res.json(customer);
});

// GET /api/customers/:id/statement — subsidiary ledger (same as /reports/customer-statement)
router.get('/:id/statement', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT j.journal_date, j.narration, l.debit, l.credit
     FROM gl_journal_line l
     JOIN gl_journal j ON j.id = l.journal_id AND j.status = 'posted'
     WHERE l.customer_id = $1
     ORDER BY j.journal_date`,
    [req.params.id]
  );
  res.json(rows);
});

module.exports = router;
