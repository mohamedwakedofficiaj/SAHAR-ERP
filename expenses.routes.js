const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requireCompanyAccess } = require('../middleware/companyScope');

const router = express.Router();
router.use(requireAuth);

// GET /api/reports/trial-balance?company_id=... — one company's own book
router.get('/trial-balance', requireCompanyAccess, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT account_code, account_name, account_type, total_debit, total_credit, balance
       FROM v_trial_balance WHERE company_id = $1 ORDER BY account_code`,
      [req.companyId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'تعذر جلب ميزان المراجعة.' });
  }
});

// GET /api/reports/consolidated-trial-balance — merges every company the
// user can access, and nets out any account flagged is_intercompany=true
// (matching the elimination rule from the ERP Master Blueprint Volume 1).
router.get('/consolidated-trial-balance', async (req, res) => {
  try {
    const hasAllCompaniesPermission = req.user.permissions?.all === true;
    const companyFilter = hasAllCompaniesPermission
      ? `c.tenant_id = $1`
      : `c.tenant_id = $1 AND c.id IN (SELECT company_id FROM user_company_access WHERE user_id = $2)`;
    const params = hasAllCompaniesPermission ? [req.user.tenantId] : [req.user.tenantId, req.user.userId];

    const { rows: accountRows } = await pool.query(
      `SELECT a.name AS account_name, a.is_intercompany, vtb.total_debit, vtb.total_credit
       FROM v_trial_balance vtb
       JOIN gl_accounts a ON a.id = vtb.account_id
       JOIN companies c ON c.id = vtb.company_id
       WHERE ${companyFilter}`,
      params
    );

    const merged = {};
    let icDebit = 0, icCredit = 0;
    for (const row of accountRows) {
      if (row.is_intercompany) {
        icDebit += Number(row.total_debit);
        icCredit += Number(row.total_credit);
        continue; // excluded from the merged consolidated lines — eliminated on consolidation
      }
      if (!merged[row.account_name]) {
        merged[row.account_name] = { account_name: row.account_name, total_debit: 0, total_credit: 0 };
      }
      merged[row.account_name].total_debit += Number(row.total_debit);
      merged[row.account_name].total_credit += Number(row.total_credit);
    }

    const consolidatedRows = Object.values(merged).map(r => ({
      ...r,
      balance: r.total_debit - r.total_credit,
    }));

    res.json({
      rows: consolidatedRows,
      intercompanyElimination: {
        debit: icDebit,
        credit: icCredit,
        note: (icDebit > 0 || icCredit > 0)
          ? `تم استبعاد معاملات بينية بين الشركات بقيمة ${Math.max(icDebit, icCredit).toLocaleString('en-US')} من الأرقام المجمّعة.`
          : null,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'تعذر إعداد التقرير المجمّع.' });
  }
});

// GET /api/reports/customer-statement/:customerId — subsidiary ledger for one customer
router.get('/customer-statement/:customerId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT j.journal_date, j.narration, l.debit, l.credit
       FROM gl_journal_line l
       JOIN gl_journal j ON j.id = l.journal_id AND j.status = 'posted'
       WHERE l.customer_id = $1
       ORDER BY j.journal_date`,
      [req.params.customerId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'تعذر جلب كشف الحساب.' });
  }
});

module.exports = router;
