const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requireCompanyAccess } = require('../middleware/companyScope');
const { recordExpense } = require('../services/postingEngine');

const router = express.Router();
router.use(requireAuth);

router.get('/', requireCompanyAccess, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT e.*, b.name AS bank_name, emp.name AS custody_holder_name
     FROM expenses e
     LEFT JOIN banks b ON b.id = e.bank_id
     LEFT JOIN custody_accounts ca ON ca.id = e.custody_id
     LEFT JOIN employees emp ON emp.id = ca.employee_id
     WHERE e.company_id = $1 ORDER BY e.expense_date DESC`,
    [req.companyId]
  );
  res.json(rows);
});

// POST /api/expenses  { company_id, category, project_id, amount, description, source: 'bank'|'custody', bank_id?, custody_id? }
router.post('/', requireCompanyAccess, async (req, res) => {
  const { category, project_id, amount, bank_id, custody_id, description } = req.body;
  if (!category || !amount || (!bank_id && !custody_id)) {
    return res.status(400).json({ error: 'التصنيف، المبلغ، ومصدر الصرف (بنك أو عهدة) مطلوبون.' });
  }
  try {
    const result = await recordExpense(
      req.user.tenantId, req.companyId,
      { category, projectId: project_id, amount, bankId: bank_id, custodyId: custody_id, description },
      req.user.userId
    );
    res.status(201).json({ message: 'تم تسجيل المصروف.', ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
