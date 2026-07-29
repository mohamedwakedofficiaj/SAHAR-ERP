const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requireCompanyAccess } = require('../middleware/companyScope');
const { postJournal } = require('../services/postingEngine');

const router = express.Router();
router.use(requireAuth);

// GET /api/suppliers?company_id=...
router.get('/', requireCompanyAccess, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT s.*, vb.balance
     FROM suppliers s
     LEFT JOIN v_supplier_balance vb ON vb.supplier_id = s.id
     WHERE s.company_id = $1
     ORDER BY s.name`,
    [req.companyId]
  );
  res.json(rows);
});

// POST /api/suppliers  { company_id, name, scope }
router.post('/', requireCompanyAccess, async (req, res) => {
  const { name, scope } = req.body;
  if (!name) return res.status(400).json({ error: 'اسم المورد مطلوب.' });
  const { rows: [supplier] } = await pool.query(
    `INSERT INTO suppliers (company_id, name, scope) VALUES ($1,$2,$3) RETURNING *`,
    [req.companyId, name, scope || 'موردين مواد']
  );
  res.status(201).json(supplier);
});

// PUT /api/suppliers/:id  { name, scope, on_time_pct, quality_pct }
router.put('/:id', async (req, res) => {
  const { name, scope, on_time_pct, quality_pct } = req.body;
  const { rows: [supplier] } = await pool.query(
    `UPDATE suppliers SET name = COALESCE($1,name), scope = COALESCE($2,scope),
     on_time_pct = COALESCE($3,on_time_pct), quality_pct = COALESCE($4,quality_pct) WHERE id = $5 RETURNING *`,
    [name, scope, on_time_pct, quality_pct, req.params.id]
  );
  if (!supplier) return res.status(404).json({ error: 'المورد غير موجود.' });
  res.json(supplier);
});

// POST /api/suppliers/:id/pay  { amount, bank_id, method }
// Business rule: Dr Suppliers (this specific supplier) / Cr Bank
router.post('/:id/pay', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { amount, bank_id, method } = req.body;
    if (!amount || !bank_id) throw new Error('المبلغ والبنك مطلوبان.');

    const { rows: [supplier] } = await client.query(`SELECT * FROM suppliers WHERE id = $1`, [req.params.id]);
    if (!supplier) throw new Error('المورد غير موجود.');
    const { rows: [bank] } = await client.query(`SELECT * FROM banks WHERE id = $1 FOR UPDATE`, [bank_id]);
    if (!bank) throw new Error('البنك غير موجود.');
    if (Number(bank.balance) < amount) throw new Error('رصيد البنك لا يكفي.');

    const journalId = await postJournal(client, {
      tenantId: req.user.tenantId,
      companyId: supplier.company_id,
      narration: `دفعة لمورد: ${supplier.name} (${method || 'تحويل بنكي'})`,
      sourceModule: 'PROCUREMENT',
      sourceType: 'SUPPLIER_PAYMENT',
      sourceId: supplier.id,
      userId: req.user.userId,
      lines: [
        { accountCode: '2000', debit: amount, supplierId: supplier.id },
        { accountCode: '1000', credit: amount },
      ],
    });

    await client.query(`UPDATE banks SET balance = balance - $1, statement_balance = statement_balance - $1 WHERE id = $2`, [amount, bank_id]);
    await client.query('COMMIT');
    res.json({ message: 'تم تسجيل الدفعة وترحيلها محاسبيًا.', journalId });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
