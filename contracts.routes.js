const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../db/pool');
const { signToken } = require('../utils/jwt');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'البريد الإلكتروني وكلمة المرور مطلوبان.' });
  }

  try {
    const { rows: [user] } = await pool.query(
      `SELECT u.id, u.tenant_id, u.name, u.email, u.password_hash, u.is_active,
              r.name AS role_name, r.permissions
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       WHERE u.email = $1`,
      [email]
    );

    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'بيانات الدخول غير صحيحة.' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'بيانات الدخول غير صحيحة.' });
    }

    const { rows: companies } = await pool.query(
      `SELECT c.id, c.code, c.name, c.business_type
       FROM companies c
       JOIN user_company_access uca ON uca.company_id = c.id
       WHERE uca.user_id = $1`,
      [user.id]
    );

    const token = signToken({
      userId: user.id,
      tenantId: user.tenant_id,
      roleName: user.role_name,
      permissions: user.permissions || {},
    });

    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role_name },
      companies, // companies this user is scoped to (empty + permissions.all=true means "sees everything")
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في الخادم أثناء تسجيل الدخول.' });
  }
});

module.exports = router;
