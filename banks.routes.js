const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requireCompanyAccess } = require('../middleware/companyScope');
const { issueCustody } = require('../services/postingEngine');

const router = express.Router();
router.use(requireAuth);

// GET /api/custody?company_id=...
router.get('/', requireCompanyAccess, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT c.*, e.name AS employee_name FROM custody_accounts c
     JOIN employees e ON e.id = c.employee_id
     WHERE c.company_id = $1 ORDER BY c.issued_at DESC`,
    [req.companyId]
  );
  res.json(rows);
});

// POST /api/custody  { company_id, employee_id, amount, method, bank_id }
router.post('/', requireCompanyAccess, async (req, res) => {
  const { employee_id, amount, method, bank_id } = req.body;
  if (!employee_id || !amount || !bank_id) {
    return res.status(400).json({ error: 'الموظف، المبلغ، والبنك مطلوبون.' });
  }
  try {
    const result = await issueCustody(
      req.user.tenantId, req.companyId,
      { employeeId: employee_id, amount, method, bankId: bank_id },
      req.user.userId
    );
    res.status(201).json({ message: 'تم صرف العهدة وترحيلها محاسبيًا.', ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/custody/:id/expenses — spending log for one custody account
router.get('/:id/expenses', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM expenses WHERE custody_id = $1 ORDER BY expense_date DESC`,
    [req.params.id]
  );
  res.json(rows);
});

module.exports = router;
