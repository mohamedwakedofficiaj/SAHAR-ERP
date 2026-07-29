const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requireCompanyAccess } = require('../middleware/companyScope');

const router = express.Router();
router.use(requireAuth);

router.get('/', requireCompanyAccess, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM employees WHERE company_id = $1 ORDER BY name`,
    [req.companyId]
  );
  res.json(rows);
});

router.post('/', requireCompanyAccess, async (req, res) => {
  const { name, role_title, department, hire_date, base_salary } = req.body;
  if (!name || !role_title || !base_salary) {
    return res.status(400).json({ error: 'الاسم، الوظيفة، والراتب الأساسي مطلوبون.' });
  }
  const { rows: [employee] } = await pool.query(
    `INSERT INTO employees (company_id, name, role_title, department, hire_date, base_salary)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [req.companyId, name, role_title, department || null, hire_date || null, base_salary]
  );
  res.status(201).json(employee);
});

router.put('/:id', async (req, res) => {
  const { name, role_title, department, hire_date, base_salary, status } = req.body;
  const { rows: [employee] } = await pool.query(
    `UPDATE employees SET
       name = COALESCE($1,name), role_title = COALESCE($2,role_title),
       department = COALESCE($3,department), hire_date = COALESCE($4,hire_date),
       base_salary = COALESCE($5,base_salary), status = COALESCE($6,status)
     WHERE id = $7 RETURNING *`,
    [name, role_title, department, hire_date, base_salary, status, req.params.id]
  );
  if (!employee) return res.status(404).json({ error: 'الموظف غير موجود.' });
  res.json(employee);
});

router.delete('/:id', async (req, res) => {
  const { rowCount } = await pool.query(`DELETE FROM employees WHERE id = $1`, [req.params.id]);
  if (rowCount === 0) return res.status(404).json({ error: 'الموظف غير موجود.' });
  res.json({ message: 'تم حذف الموظف.' });
});

module.exports = router;
