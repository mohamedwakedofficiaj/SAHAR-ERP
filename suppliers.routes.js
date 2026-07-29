const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requireCompanyAccess } = require('../middleware/companyScope');

const router = express.Router();
router.use(requireAuth);

// GET /api/inventory/warehouses?company_id=...
router.get('/warehouses', requireCompanyAccess, async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM warehouses WHERE company_id = $1 ORDER BY name`, [req.companyId]);
  res.json(rows);
});

router.post('/warehouses', requireCompanyAccess, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'اسم المخزن مطلوب.' });
  const { rows: [wh] } = await pool.query(
    `INSERT INTO warehouses (company_id, name) VALUES ($1,$2) RETURNING *`, [req.companyId, name]
  );
  res.status(201).json(wh);
});

// GET /api/inventory/items?company_id=...
router.get('/items', requireCompanyAccess, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT i.*, w.name AS warehouse_name FROM inventory_items i
     JOIN warehouses w ON w.id = i.warehouse_id
     WHERE i.company_id = $1 ORDER BY i.name`,
    [req.companyId]
  );
  res.json(rows);
});

router.post('/items', requireCompanyAccess, async (req, res) => {
  const { warehouse_id, name, unit, qty_on_hand, reorder_point, max_level, last_price } = req.body;
  if (!warehouse_id || !name || !unit) {
    return res.status(400).json({ error: 'المخزن، اسم الصنف، والوحدة مطلوبون.' });
  }
  const { rows: [item] } = await pool.query(
    `INSERT INTO inventory_items (company_id, warehouse_id, name, unit, qty_on_hand, reorder_point, max_level, last_price)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [req.companyId, warehouse_id, name, unit, qty_on_hand || 0, reorder_point || 0, max_level || null, last_price || 0]
  );
  res.status(201).json(item);
});

// POST /api/inventory/items/:id/issue  { qty, project_id, note }
// Manual material issue (not linked to a PO) — decreases stock directly.
router.post('/items/:id/issue', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { qty, project_id, note } = req.body;
    const { rows: [item] } = await client.query(`SELECT * FROM inventory_items WHERE id = $1 FOR UPDATE`, [req.params.id]);
    if (!item) throw new Error('الصنف غير موجود.');
    if (Number(item.qty_on_hand) < qty) throw new Error('الكمية المتاحة لا تكفي.');

    await client.query(`UPDATE inventory_items SET qty_on_hand = qty_on_hand - $1, updated_at = now() WHERE id = $2`, [qty, req.params.id]);
    await client.query(
      `INSERT INTO inventory_movements (item_id, movement_type, qty, ref_type, project_id, note)
       VALUES ($1,'issue',$2,'project_consumption',$3,$4)`,
      [req.params.id, -Math.abs(qty), project_id || null, note || null]
    );
    await client.query('COMMIT');
    res.json({ message: 'تم صرف الكمية من المخزون.' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
