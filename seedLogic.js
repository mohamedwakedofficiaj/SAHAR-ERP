const pool = require('../db/pool');

/**
 * Posts a balanced journal entry. This is the ONLY function in the entire
 * codebase that is allowed to write to gl_journal / gl_journal_line — every
 * business action (PO receipt, certificate approval, installment collection...)
 * must go through this, so there is exactly one place where "is this journal
 * balanced?" is enforced.
 *
 * @param {import('pg').PoolClient} client - an active transaction client
 * @param {object} params
 * @param {string} params.tenantId
 * @param {string} params.companyId
 * @param {string} params.narration
 * @param {string} params.sourceModule
 * @param {string} params.sourceType
 * @param {string} [params.sourceId]
 * @param {string} [params.userId]
 * @param {Array<{accountCode:string, debit?:number, credit?:number, projectId?:string, customerId?:string, supplierId?:string}>} params.lines
 * @returns {Promise<string>} the created journal's id
 */
async function postJournal(client, params) {
  const { tenantId, companyId, narration, sourceModule, sourceType, sourceId, userId, lines } = params;

  const totalDebit = lines.reduce((s, l) => s + (l.debit || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (l.credit || 0), 0);

  if (lines.length === 0) {
    throw new Error('لا يمكن ترحيل قيد بدون أي سطور.');
  }
  if (Math.abs(totalDebit - totalCredit) > 0.005) {
    throw new Error(
      `القيد غير متوازن: إجمالي المدين (${totalDebit}) لا يساوي إجمالي الدائن (${totalCredit}).`
    );
  }

  const { rows: [journal] } = await client.query(
    `INSERT INTO gl_journal (tenant_id, company_id, narration, source_module, source_type, source_id, created_by, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'posted') RETURNING id`,
    [tenantId, companyId, narration, sourceModule, sourceType, sourceId || null, userId || null]
  );

  let lineNo = 1;
  for (const line of lines) {
    const { rows: [account] } = await client.query(
      `SELECT id FROM gl_accounts WHERE company_id = $1 AND code = $2`,
      [companyId, line.accountCode]
    );
    if (!account) {
      throw new Error(`الحساب بكود "${line.accountCode}" غير موجود في شجرة حسابات هذه الشركة.`);
    }

    await client.query(
      `INSERT INTO gl_journal_line (journal_id, line_no, account_id, debit, credit, project_id, customer_id, supplier_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        journal.id, lineNo++, account.id,
        line.debit || 0, line.credit || 0,
        line.projectId || null, line.customerId || null, line.supplierId || null,
      ]
    );
  }

  return journal.id;
}

/**
 * Business rule: Purchase Order marked as received.
 *   - increases the inventory item's qty_on_hand (if linked to one)
 *   - posts Dr Inventory / Cr Suppliers (this PO's supplier)
 * This is the concrete proof that Procurement, Inventory, and Finance are
 * the same system: one action updates all three consistently.
 */
async function receivePurchaseOrder(tenantId, poId, userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [po] } = await client.query(
      `SELECT * FROM purchase_orders WHERE id = $1 FOR UPDATE`,
      [poId]
    );
    if (!po) throw new Error('أمر الشراء غير موجود.');
    if (po.status === 'received') throw new Error('هذا الأمر مستلم بالفعل بالكامل.');

    const totalValue = Number(po.qty) * Number(po.unit_price);

    // 1) increase stock, if this PO is linked to an inventory item
    if (po.inventory_item_id) {
      await client.query(
        `UPDATE inventory_items SET qty_on_hand = qty_on_hand + $1, last_price = $2, updated_at = now() WHERE id = $3`,
        [po.qty, po.unit_price, po.inventory_item_id]
      );
      await client.query(
        `INSERT INTO inventory_movements (item_id, movement_type, qty, ref_type, ref_id, note)
         VALUES ($1,'receipt',$2,'purchase_order',$3,$4)`,
        [po.inventory_item_id, po.qty, po.id, `استلام أمر شراء ${po.code}`]
      );
    }

    // 2) post Dr Inventory / Cr Suppliers
    const journalId = await postJournal(client, {
      tenantId,
      companyId: po.company_id,
      narration: `استلام أمر شراء ${po.code}`,
      sourceModule: 'PROCUREMENT',
      sourceType: 'PURCHASE_ORDER_RECEIPT',
      sourceId: po.id,
      userId,
      lines: [
        { accountCode: '1300', debit: totalValue }, // المخزون — مواد بناء (adjust code per company's COA)
        { accountCode: '2000', credit: totalValue, supplierId: po.supplier_id }, // موردون
      ],
    });

    await client.query(
      `UPDATE purchase_orders SET status = 'received', received_date = CURRENT_DATE WHERE id = $1`,
      [po.id]
    );

    await client.query('COMMIT');
    return { journalId, totalValue };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Business rule: Subcontractor progress certificate approved.
 *   - increases the subcontractor's executed_value
 *   - posts Dr WIP / Cr Subcontractor Payable (net of retention) + Cr Retention Payable
 * Mirrors the worked example in the ERP Master Blueprint Volume 1.
 */
async function approveSubcontractorCertificate(tenantId, subcontractorId, { code, value }, userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [sub] } = await client.query(
      `SELECT * FROM subcontractors WHERE id = $1 FOR UPDATE`,
      [subcontractorId]
    );
    if (!sub) throw new Error('المقاول من الباطن غير موجود.');

    const retention = value * (Number(sub.retention_pct) / 100);
    const netPayable = value - retention;

    const { rows: [cert] } = await client.query(
      `INSERT INTO subcontractor_certificates (subcontractor_id, code, value) VALUES ($1,$2,$3) RETURNING id`,
      [subcontractorId, code, value]
    );

    const journalId = await postJournal(client, {
      tenantId,
      companyId: sub.company_id,
      narration: `شهادة إنجاز ${code} — ${sub.name}`,
      sourceModule: 'SUBCONTRACTOR',
      sourceType: 'PROGRESS_CERT',
      sourceId: cert.id,
      userId,
      lines: [
        { accountCode: '1100', debit: value, projectId: sub.project_id }, // أعمال تحت التنفيذ (WIP)
        { accountCode: '2000', credit: netPayable, supplierId: subcontractorId }, // موردون ومقاولون من الباطن
        { accountCode: '2000', credit: retention, supplierId: subcontractorId }, // (retention held under the same control account)
      ],
    });

    await client.query(
      `UPDATE subcontractors SET executed_value = executed_value + $1 WHERE id = $2`,
      [value, subcontractorId]
    );
    await client.query(
      `UPDATE subcontractor_certificates SET journal_id = $1 WHERE id = $2`,
      [journalId, cert.id]
    );

    await client.query('COMMIT');
    return { certificateId: cert.id, journalId, retention, netPayable };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Business rule: customer installment collected.
 *   - posts Dr Bank / Cr Customer AR (this specific customer)
 *   - increases the bank's balance
 */
async function collectInstallment(tenantId, installmentId, { amount, bankId }, userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [inst] } = await client.query(
      `SELECT i.*, c.company_id, c.customer_id
       FROM installments i
       JOIN contracts c ON c.id = i.contract_id
       WHERE i.id = $1 FOR UPDATE`,
      [installmentId]
    );
    if (!inst) throw new Error('القسط غير موجود.');

    const { rows: [bank] } = await client.query(
      `SELECT * FROM banks WHERE id = $1 FOR UPDATE`, [bankId]
    );
    if (!bank) throw new Error('البنك غير موجود.');

    const journalId = await postJournal(client, {
      tenantId,
      companyId: inst.company_id,
      narration: `تحصيل قسط رقم ${inst.installment_no}`,
      sourceModule: 'REAL_ESTATE',
      sourceType: 'RE_INSTALLMENT_RECEIPT',
      sourceId: inst.id,
      userId,
      lines: [
        { accountCode: '1000', debit: amount }, // البنك
        { accountCode: '1100', credit: amount, customerId: inst.customer_id }, // عملاء — أقساط الوحدات
      ],
    });

    const newPaid = Number(inst.paid) + Number(amount);
    await client.query(
      `UPDATE installments SET paid = $1, status = CASE WHEN $1 >= amount THEN 'paid' ELSE status END WHERE id = $2`,
      [newPaid, installmentId]
    );
    await client.query(
      `UPDATE banks SET balance = balance + $1, statement_balance = statement_balance + $1 WHERE id = $2`,
      [amount, bankId]
    );

    await client.query('COMMIT');
    return { journalId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Business rule: daily expense recorded.
 *   - source 'bank': posts Dr Operating Expenses / Cr Bank, decreases the bank's balance directly
 *   - source 'custody': decreases a custody (petty cash) account's balance instead — no separate
 *     journal entry is posted here, because the custody's own funding-from-bank event already hit
 *     the ledger when it was issued (see issueCustody below). This avoids double-counting.
 */
async function recordExpense(tenantId, companyId, { category, projectId, amount, bankId, custodyId, description }, userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (custodyId) {
      const { rows: [custody] } = await client.query(
        `SELECT * FROM custody_accounts WHERE id = $1 FOR UPDATE`, [custodyId]
      );
      if (!custody) throw new Error('العهدة غير موجودة.');
      if (Number(custody.balance) < amount) throw new Error('رصيد العهدة لا يكفي لتغطية هذا المصروف.');

      const { rows: [expense] } = await client.query(
        `INSERT INTO expenses (company_id, category, project_id, amount, source, custody_id, description)
         VALUES ($1,$2,$3,$4,'custody',$5,$6) RETURNING id`,
        [companyId, category, projectId || null, amount, custodyId, description]
      );
      await client.query(`UPDATE custody_accounts SET balance = balance - $1 WHERE id = $2`, [amount, custodyId]);
      await client.query('COMMIT');
      return { expenseId: expense.id, journalId: null, source: 'custody' };
    }

    const { rows: [bank] } = await client.query(
      `SELECT * FROM banks WHERE id = $1 FOR UPDATE`, [bankId]
    );
    if (!bank) throw new Error('البنك غير موجود.');
    if (Number(bank.balance) < amount) throw new Error('رصيد البنك لا يكفي لتغطية هذا المصروف.');

    const { rows: [expense] } = await client.query(
      `INSERT INTO expenses (company_id, category, project_id, amount, source, bank_id, description)
       VALUES ($1,$2,$3,$4,'bank',$5,$6) RETURNING id`,
      [companyId, category, projectId || null, amount, bankId, description]
    );

    const journalId = await postJournal(client, {
      tenantId,
      companyId,
      narration: `مصروف: ${description || category}`,
      sourceModule: 'EXPENSE',
      sourceType: 'DAILY_EXPENSE',
      sourceId: expense.id,
      userId,
      lines: [
        { accountCode: '5000', debit: amount, projectId: projectId || null }, // مصاريف تشغيلية
        { accountCode: '1000', credit: amount }, // البنك
      ],
    });

    await client.query(
      `UPDATE banks SET balance = balance - $1, statement_balance = statement_balance - $1 WHERE id = $2`,
      [amount, bankId]
    );
    await client.query(`UPDATE expenses SET journal_id = $1 WHERE id = $2`, [journalId, expense.id]);

    await client.query('COMMIT');
    return { expenseId: expense.id, journalId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Business rule: petty cash custody issued to an employee.
 *   - posts Dr Custody Advances (1250) / Cr Bank — the advance is an asset until spent,
 *     not an immediate expense (spending against it later just reduces the custody's
 *     own balance — see recordExpense above — it does not re-hit the bank or the GL).
 */
async function issueCustody(tenantId, companyId, { employeeId, amount, method, bankId }, userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [bank] } = await client.query(`SELECT * FROM banks WHERE id = $1 FOR UPDATE`, [bankId]);
    if (!bank) throw new Error('البنك غير موجود.');
    if (Number(bank.balance) < amount) throw new Error('رصيد البنك لا يكفي لصرف هذه العهدة.');

    const { rows: [custody] } = await client.query(
      `INSERT INTO custody_accounts (company_id, employee_id, method, opening_amount, balance, bank_id)
       VALUES ($1,$2,$3,$4,$4,$5) RETURNING id`,
      [companyId, employeeId, method || 'نقدًا', amount, bankId]
    );

    const journalId = await postJournal(client, {
      tenantId,
      companyId,
      narration: `صرف عهدة (${method || 'نقدًا'})`,
      sourceModule: 'TREASURY',
      sourceType: 'CUSTODY_ISSUE',
      sourceId: custody.id,
      userId,
      lines: [
        { accountCode: '1250', debit: amount }, // عهد نقدية (أصل)
        { accountCode: '1000', credit: amount }, // البنك
      ],
    });

    await client.query(
      `UPDATE banks SET balance = balance - $1, statement_balance = statement_balance - $1 WHERE id = $2`,
      [amount, bankId]
    );
    await client.query(`UPDATE custody_accounts SET journal_id = $1 WHERE id = $2`, [journalId, custody.id]);

    await client.query('COMMIT');
    return { custodyId: custody.id, journalId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  postJournal,
  issueCustody,
  receivePurchaseOrder,
  approveSubcontractorCertificate,
  collectInstallment,
  recordExpense,
};
