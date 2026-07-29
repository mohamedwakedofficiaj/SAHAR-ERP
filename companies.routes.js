const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requireCompanyAccess } = require('../middleware/companyScope');
const { collectInstallment } = require('../services/postingEngine');

const router = express.Router();
router.use(requireAuth);

router.get('/', requireCompanyAccess, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ct.*, cu.name AS customer_name
     FROM contracts ct
     JOIN customers cu ON cu.id = ct.customer_id
     WHERE ct.company_id = $1
     ORDER BY ct.created_at DESC`,
    [req.companyId]
  );
  res.json(rows);
});

router.get('/:id/installments', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM installments WHERE contract_id = $1 ORDER BY installment_no`,
    [req.params.id]
  );
  res.json(rows);
});

// POST /api/installments/:id/collect  { amount, bank_id }
router.post('/installments/:id/collect', async (req, res) => {
  const { amount, bank_id } = req.body;
  if (!amount || !bank_id) {
    return res.status(400).json({ error: 'المبلغ والبنك مطلوبان.' });
  }
  try {
    const result = await collectInstallment(
      req.user.tenantId, req.params.id, { amount, bankId: bank_id }, req.user.userId
    );
    res.json({ message: 'تم تحصيل القسط وترحيله محاسبيًا.', ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
