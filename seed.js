const bcrypt = require('bcrypt');

/**
 * Applies all seed data using the given pool. Does NOT call pool.end() —
 * the caller owns the pool's lifecycle (the standalone CLI script ends it,
 * the server's boot-time auto-setup keeps using it for live requests).
 */
async function applySeed(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ---- Tenant ----
    const { rows: [tenant] } = await client.query(
      `INSERT INTO tenants (name) VALUES ($1) RETURNING id`,
      ['مجموعة الوسام القابضة']
    );

    // ---- Companies ----
    const companySpecs = [
      { code: 'CONST', name: 'الوسام للمقاولات العامة', business_type: 'construction' },
      { code: 'RE',    name: 'الوسام للتطوير العقاري',   business_type: 'real_estate' },
      { code: 'SUPPLY',name: 'الوسام للتوريدات والمقاولات', business_type: 'supply' },
    ];
    const companies = {};
    for (const spec of companySpecs) {
      const { rows: [c] } = await client.query(
        `INSERT INTO companies (tenant_id, code, name, business_type) VALUES ($1,$2,$3,$4) RETURNING id, code`,
        [tenant.id, spec.code, spec.name, spec.business_type]
      );
      companies[c.code] = c.id;
    }

    // ---- Roles ----
    const { rows: [adminRole] } = await client.query(
      `INSERT INTO roles (tenant_id, name, permissions) VALUES ($1,'admin',$2) RETURNING id`,
      [tenant.id, JSON.stringify({ all: true })]
    );

    // ---- Admin user (default password: ChangeMe123! — force reset on first login in production) ----
    const passwordHash = await bcrypt.hash('ChangeMe123!', 10);
    const { rows: [admin] } = await client.query(
      `INSERT INTO users (tenant_id, name, email, password_hash, role_id) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [tenant.id, 'محمد واكد', 'mohamedwakedofficial@gmail.com', passwordHash, adminRole.id]
    );
    // Admin gets access to all three companies
    for (const companyId of Object.values(companies)) {
      await client.query(
        `INSERT INTO user_company_access (user_id, company_id) VALUES ($1,$2)`,
        [admin.id, companyId]
      );
    }

    // ---- Projects ----
    const { rows: [projConst] } = await client.query(
      `INSERT INTO projects (company_id, code, name, budget) VALUES ($1,'PRJ-001','برج النيل التجاري',28000000) RETURNING id`,
      [companies.CONST]
    );
    const { rows: [projRE] } = await client.query(
      `INSERT INTO projects (company_id, code, name, budget) VALUES ($1,'PRJ-RE-01','كمبوند الياسمين — المرحلة 2',40000000) RETURNING id`,
      [companies.RE]
    );

    // ---- Chart of Accounts per company ----
    const coa = {
      CONST: [
        ['1000', 'البنك — الحساب الجاري (بنك المقاولات)', 'asset', false],
        ['1100', 'أعمال تحت التنفيذ (WIP)', 'asset', false],
        ['1250', 'عهد نقدية', 'asset', false],
        ['2000', 'موردون ومقاولون من الباطن', 'liability', false],
        ['1200', 'ضريبة القيمة المضافة (مدخلات)', 'asset', false],
        ['1500', 'الأصول الثابتة — معدات وآليات', 'asset', false],
        ['1510', 'مجمع إهلاك المعدات', 'asset', false],
        ['2100', 'مستحق لشركة الوسام للتوريدات (معاملة بينية)', 'liability', true],
        ['5000', 'مصاريف تشغيلية', 'expense', false],
      ],
      RE: [
        ['1000', 'البنك — الحساب الجاري (بنك التطوير العقاري)', 'asset', false],
        ['1100', 'عملاء — أقساط الوحدات', 'asset', false],
        ['1250', 'عهد نقدية', 'asset', false],
        ['4000', 'إيراد بيع وحدات عقارية', 'revenue', false],
        ['2000', 'عمولات وسطاء مستحقة', 'liability', false],
        ['5000', 'مصاريف تشغيلية', 'expense', false],
      ],
      SUPPLY: [
        ['1000', 'البنك — الحساب الجاري (بنك التوريدات)', 'asset', false],
        ['1300', 'المخزون — مواد بناء', 'asset', false],
        ['1250', 'عهد نقدية', 'asset', false],
        ['2000', 'موردون', 'liability', false],
        ['1400', 'مستحق من شركة الوسام للمقاولات (معاملة بينية)', 'asset', true],
        ['5100', 'تكلفة البضاعة المباعة', 'expense', false],
        ['5000', 'مصاريف تشغيلية', 'expense', false],
      ],
    };
    const accountIds = {}; // accountIds[companyCode][accountCode] = uuid
    for (const [code, accounts] of Object.entries(coa)) {
      accountIds[code] = {};
      for (const [acctCode, name, type, isIC] of accounts) {
        const { rows: [a] } = await client.query(
          `INSERT INTO gl_accounts (company_id, code, name, account_type, is_intercompany) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [companies[code], acctCode, name, type, isIC]
        );
        accountIds[code][acctCode] = a.id;
      }
    }

    // ---- Banks ----
    const { rows: [bankConst] } = await client.query(
      `INSERT INTO banks (company_id, name, account_number, currency, balance, statement_balance) VALUES ($1,'البنك الأهلي المصري','EG04 0001 1187','EGP',3650000,3650000) RETURNING id`,
      [companies.CONST]
    );
    await client.query(
      `INSERT INTO banks (company_id, name, account_number, currency, balance, statement_balance) VALUES ($1,'بنك مصر','EG09 0002 4420','EGP',1100000,1040000)`,
      [companies.RE]
    );
    await client.query(
      `INSERT INTO banks (company_id, name, account_number, currency, balance, statement_balance) VALUES ($1,'HSBC','EG21 0003 7765','USD',150000,150000)`,
      [companies.SUPPLY]
    );

    // ---- Warehouses + inventory (SUPPLY company) ----
    const { rows: [wh] } = await client.query(
      `INSERT INTO warehouses (company_id, name) VALUES ($1,'مخزن مشروع النيل') RETURNING id`,
      [companies.SUPPLY]
    );
    await client.query(
      `INSERT INTO inventory_items (company_id, warehouse_id, name, unit, qty_on_hand, reorder_point, max_level, last_price)
       VALUES ($1,$2,'حديد تسليح 16مم','طن',420,150,600,38200)`,
      [companies.SUPPLY, wh.id]
    );

    // ---- Suppliers ----
    const { rows: [supplierIron] } = await client.query(
      `INSERT INTO suppliers (company_id, name, scope, on_time_pct, quality_pct) VALUES ($1,'شركة المتحدة للحديد','materials',92,96) RETURNING id`,
      [companies.SUPPLY]
    );

    // ---- Subcontractors (CONST company) ----
    await client.query(
      `INSERT INTO subcontractors (company_id, name, scope_of_work, project_id, contract_value, executed_value, retention_pct)
       VALUES ($1,'مقاولات الدلتا','أعمال الخرسانة',$2,18500000,14800000,10)`,
      [companies.CONST, projConst.id]
    );

    // ---- Customers + contract + installments (RE company) ----
    const { rows: [customer] } = await client.query(
      `INSERT INTO customers (company_id, name) VALUES ($1,'أحمد عبد الرحمن') RETURNING id`,
      [companies.RE]
    );
    const { rows: [contract] } = await client.query(
      `INSERT INTO contracts (company_id, customer_id, project_id, unit_code, value, down_payment)
       VALUES ($1,$2,$3,'B-114',3200000,480000) RETURNING id`,
      [companies.RE, customer.id, projRE.id]
    );
    const installmentPlan = [
      [12, '2026-05-15', 150000, 150000, 'paid'],
      [13, '2026-06-15', 150000, 150000, 'paid'],
      [14, '2026-07-15', 150000, 0, 'due'],
      [15, '2026-08-15', 150000, 0, 'not_due'],
    ];
    for (const [no, due, amount, paid, status] of installmentPlan) {
      await client.query(
        `INSERT INTO installments (contract_id, installment_no, due_date, amount, paid, status) VALUES ($1,$2,$3,$4,$5,$6)`,
        [contract.id, no, due, amount, paid, status]
      );
    }

    // ---- Employees ----
    await client.query(
      `INSERT INTO employees (company_id, name, role_title, department, hire_date, base_salary, status)
       VALUES ($1,'محمود سعيد','مهندس موقع أول','الإنشاءات','2022-03-01',28000,'active')`,
      [companies.CONST]
    );

    await client.query('COMMIT');
    console.log('✔ Seed completed successfully.');
    console.log('  Admin login: mohamedwakedofficial@gmail.com / ChangeMe123!  (change this immediately)');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = applySeed;
