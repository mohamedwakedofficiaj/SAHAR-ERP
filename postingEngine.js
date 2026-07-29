const pool = require('../db/pool');

/**
 * Reads company_id from the request (query param, body, or route param — in that
 * priority) and verifies:
 *   1. It belongs to the same tenant as the logged-in user.
 *   2. The user has been explicitly granted access to it (via user_company_access),
 *      UNLESS their role has the "all_companies" permission (holding-level exec).
 *
 * This is the actual enforcement point for "a subsidiary user can never see
 * another subsidiary's data" — it happens on every request at the API layer,
 * not just by hiding a menu item in the frontend.
 */
async function requireCompanyAccess(req, res, next) {
  const companyId =
    req.params.companyId || req.body.company_id || req.query.company_id;

  if (!companyId) {
    return res.status(400).json({ error: 'company_id مطلوب لهذا الطلب.' });
  }

  try {
    const { rows: [company] } = await pool.query(
      `SELECT id, tenant_id FROM companies WHERE id = $1`,
      [companyId]
    );

    if (!company || company.tenant_id !== req.user.tenantId) {
      return res.status(404).json({ error: 'الشركة غير موجودة.' });
    }

    const hasAllCompaniesPermission = req.user.permissions?.all === true;

    if (!hasAllCompaniesPermission) {
      const { rows } = await pool.query(
        `SELECT 1 FROM user_company_access WHERE user_id = $1 AND company_id = $2`,
        [req.user.userId, companyId]
      );
      if (rows.length === 0) {
        return res.status(403).json({ error: 'لا تملك صلاحية الوصول لبيانات هذه الشركة.' });
      }
    }

    req.companyId = companyId;
    next();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'خطأ في التحقق من صلاحية الشركة.' });
  }
}

module.exports = { requireCompanyAccess };
