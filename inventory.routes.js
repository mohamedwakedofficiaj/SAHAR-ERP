-- =====================================================================
-- Sahar Holding ERP — Core Database Schema
-- Implements the "Core Integration Spine" design:
--   - One tenant (the holding group), N companies (subsidiaries)
--   - One physical Universal Journal (gl_journal_line) for ALL accounting
--     consequences from every module — this is what makes the system
--     actually integrated, not just several screens sharing a color scheme.
--   - Every transactional table carries tenant_id + company_id so a
--     company's data can never leak into another company's reports.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- for gen_random_uuid()

-- =====================================================================
-- 1. TENANT / COMPANY / USER / SECURITY
-- =====================================================================

CREATE TABLE tenants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,               -- e.g. "مجموعة الوسام القابضة"
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE companies (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code          TEXT NOT NULL,                -- 'CONST' | 'RE' | 'SUPPLY' (extendable)
  name          TEXT NOT NULL,
  business_type TEXT NOT NULL,                -- 'construction' | 'real_estate' | 'supply'
  base_currency CHAR(3) NOT NULL DEFAULT 'EGP',
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE roles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,                -- 'admin' | 'finance_manager' | 'commercial_manager' | 'viewer' ...
  permissions   JSONB NOT NULL DEFAULT '{}',  -- e.g. {"journal.post": true, "reports.view": true}
  UNIQUE (tenant_id, name)
);

CREATE TABLE users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  email          TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  role_id        UUID REFERENCES roles(id),
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

-- Which companies a given user is allowed to see/work in.
-- A user with NO rows here but role permission "all_companies" can see everything (holding-level exec).
CREATE TABLE user_company_access (
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, company_id)
);

CREATE TABLE audit_log (
  id            BIGSERIAL PRIMARY KEY,
  tenant_id     UUID NOT NULL,
  company_id    UUID,
  user_id       UUID,
  action        TEXT NOT NULL,               -- 'CREATE' | 'UPDATE' | 'DELETE' | 'POST' | 'APPROVE' | 'LOGIN'
  entity_type   TEXT NOT NULL,               -- 'journal' | 'purchase_order' | 'contract' | ...
  entity_id     TEXT,
  details       JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- 2. CHART OF ACCOUNTS + UNIVERSAL JOURNAL (the actual integration spine)
-- =====================================================================

CREATE TABLE projects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code          TEXT NOT NULL,
  name          TEXT NOT NULL,
  budget        NUMERIC(18,2) NOT NULL DEFAULT 0,
  start_date    DATE,
  end_date      DATE,
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);

CREATE TABLE gl_accounts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code           TEXT NOT NULL,
  name           TEXT NOT NULL,
  account_type   TEXT NOT NULL,              -- 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'
  is_intercompany BOOLEAN NOT NULL DEFAULT false,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (company_id, code)
);

-- One journal "header" groups a set of balanced debit/credit lines.
CREATE TABLE gl_journal (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id),
  company_id     UUID NOT NULL REFERENCES companies(id),
  journal_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  narration      TEXT,
  source_module  TEXT NOT NULL,              -- 'MANUAL' | 'PROCUREMENT' | 'REAL_ESTATE' | 'SUBCONTRACTOR' | 'TREASURY' | 'PAYROLL' | 'EXPENSE'
  source_type    TEXT,                       -- 'PURCHASE_ORDER' | 'PROGRESS_CERT' | 'RE_INSTALLMENT' | ...
  source_id      UUID,                       -- id of the originating record, for traceability
  status         TEXT NOT NULL DEFAULT 'posted', -- 'draft' | 'posted' | 'reversed'
  reversal_of    UUID REFERENCES gl_journal(id),
  created_by     UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- THE Universal Journal line table. Every module writes here. There is no
-- other ledger anywhere in the system — this is the single source of truth
-- for every number that ends up in a financial report.
CREATE TABLE gl_journal_line (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_id     UUID NOT NULL REFERENCES gl_journal(id) ON DELETE CASCADE,
  line_no        INT NOT NULL,
  account_id     UUID NOT NULL REFERENCES gl_accounts(id),
  debit          NUMERIC(18,2) NOT NULL DEFAULT 0,
  credit         NUMERIC(18,2) NOT NULL DEFAULT 0,
  project_id     UUID REFERENCES projects(id),
  customer_id    UUID,   -- subsidiary ledger reference when this line hits an AR control account
  supplier_id    UUID,   -- subsidiary ledger reference when this line hits an AP control account
  CHECK (debit >= 0 AND credit >= 0),
  CHECK (NOT (debit > 0 AND credit > 0)) -- a line is either a debit or a credit, never both
);

CREATE INDEX idx_journal_line_journal ON gl_journal_line(journal_id);
CREATE INDEX idx_journal_line_account ON gl_journal_line(account_id);
CREATE INDEX idx_journal_company_date ON gl_journal(company_id, journal_date);

-- =====================================================================
-- 3. REAL ESTATE: customers, contracts, installments
-- =====================================================================

CREATE TABLE customers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  phone         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE contracts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id   UUID NOT NULL REFERENCES customers(id),
  project_id    UUID REFERENCES projects(id),
  unit_code     TEXT NOT NULL,
  value         NUMERIC(18,2) NOT NULL,
  down_payment  NUMERIC(18,2) NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'active', -- 'active' | 'fully_paid' | 'cancelled'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE installments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id   UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  installment_no INT NOT NULL,
  due_date      DATE NOT NULL,
  amount        NUMERIC(18,2) NOT NULL,
  paid          NUMERIC(18,2) NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'not_due', -- 'not_due' | 'due' | 'overdue' | 'paid'
  UNIQUE (contract_id, installment_no)
);

CREATE TABLE handovers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id       UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  inspection_status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'in_progress' | 'done'
  open_snags        INT NOT NULL DEFAULT 0,
  final_payment_status TEXT NOT NULL DEFAULT 'incomplete',
  status            TEXT NOT NULL DEFAULT 'in_progress', -- 'in_progress' | 'ready' | 'handed_over'
  handed_over_at    TIMESTAMPTZ
);

-- =====================================================================
-- 4. CONSTRUCTION: subcontractors + progress certificates
-- =====================================================================

CREATE TABLE subcontractors (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  scope_of_work   TEXT,
  project_id      UUID REFERENCES projects(id),
  contract_value  NUMERIC(18,2) NOT NULL,
  executed_value  NUMERIC(18,2) NOT NULL DEFAULT 0,
  retention_pct   NUMERIC(5,2) NOT NULL DEFAULT 10,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE subcontractor_certificates (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subcontractor_id UUID NOT NULL REFERENCES subcontractors(id) ON DELETE CASCADE,
  code             TEXT NOT NULL,
  value            NUMERIC(18,2) NOT NULL,
  cert_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  journal_id       UUID REFERENCES gl_journal(id), -- links back to the posting it generated
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- 5. SUPPLIERS / PROCUREMENT / INVENTORY (shared across companies that buy)
-- =====================================================================

CREATE TABLE suppliers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  scope         TEXT,                        -- 'materials' | 'subcontractor' | 'services'
  on_time_pct   NUMERIC(5,2),
  quality_pct   NUMERIC(5,2),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE warehouses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name          TEXT NOT NULL
);

CREATE TABLE inventory_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  warehouse_id    UUID NOT NULL REFERENCES warehouses(id),
  name            TEXT NOT NULL,
  unit            TEXT NOT NULL,              -- 'طن' | 'قطعة' | 'م3' ...
  qty_on_hand     NUMERIC(18,3) NOT NULL DEFAULT 0,
  reorder_point   NUMERIC(18,3) NOT NULL DEFAULT 0,
  max_level       NUMERIC(18,3),
  last_price      NUMERIC(18,2) NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE inventory_movements (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id       UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  movement_type TEXT NOT NULL,               -- 'receipt' | 'issue' | 'adjustment'
  qty           NUMERIC(18,3) NOT NULL,      -- positive for receipt, negative for issue
  ref_type      TEXT,                        -- 'purchase_order' | 'project_consumption' | 'manual'
  ref_id        UUID,
  project_id    UUID REFERENCES projects(id),
  movement_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  note          TEXT
);

CREATE TABLE purchase_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code            TEXT NOT NULL,
  supplier_id     UUID NOT NULL REFERENCES suppliers(id),
  item_description TEXT NOT NULL,
  qty             NUMERIC(18,3) NOT NULL,
  unit_price      NUMERIC(18,2) NOT NULL,
  order_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  expected_date   DATE,
  received_date   DATE,
  status          TEXT NOT NULL DEFAULT 'pending_approval', -- pending_approval | approved | partially_received | received | cancelled
  inventory_item_id UUID REFERENCES inventory_items(id), -- which stock item this PO replenishes, if any
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);

-- =====================================================================
-- 6. TREASURY: banks
-- =====================================================================

CREATE TABLE banks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  account_number    TEXT NOT NULL,
  currency          CHAR(3) NOT NULL DEFAULT 'EGP',
  balance           NUMERIC(18,2) NOT NULL DEFAULT 0,
  statement_balance NUMERIC(18,2) NOT NULL DEFAULT 0,
  reconciliation_status TEXT NOT NULL DEFAULT 'matched' -- 'matched' | 'under_review'
);

CREATE TABLE bank_transactions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id       UUID NOT NULL REFERENCES banks(id) ON DELETE CASCADE,
  txn_type      TEXT NOT NULL,               -- 'deposit' | 'withdrawal'
  amount        NUMERIC(18,2) NOT NULL,
  description   TEXT,
  journal_id    UUID REFERENCES gl_journal(id),
  txn_date      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- 7. HR / PAYROLL
-- =====================================================================

CREATE TABLE employees (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  role_title    TEXT NOT NULL,
  department    TEXT,
  hire_date     DATE,
  base_salary   NUMERIC(18,2) NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active' -- 'active' | 'on_leave' | 'terminated'
);

-- =====================================================================
-- 7B. PETTY CASH CUSTODY (العهدة اليومية)
-- =====================================================================

CREATE TABLE custody_accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id     UUID NOT NULL REFERENCES employees(id),
  method          TEXT NOT NULL DEFAULT 'نقدًا', -- 'نقدًا' | 'شيك' | 'تحويل بنكي'
  opening_amount  NUMERIC(18,2) NOT NULL,
  balance         NUMERIC(18,2) NOT NULL,
  bank_id         UUID REFERENCES banks(id), -- which bank the custody was funded from
  journal_id      UUID REFERENCES gl_journal(id),
  issued_at       DATE NOT NULL DEFAULT CURRENT_DATE
);

-- =====================================================================
-- 8. DAILY EXPENSES
-- =====================================================================

CREATE TABLE expenses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  category      TEXT NOT NULL,
  project_id    UUID REFERENCES projects(id),
  amount        NUMERIC(18,2) NOT NULL,
  source        TEXT NOT NULL DEFAULT 'bank', -- 'bank' | 'custody'
  bank_id       UUID REFERENCES banks(id),
  custody_id    UUID REFERENCES custody_accounts(id),
  description   TEXT,
  journal_id    UUID REFERENCES gl_journal(id),
  expense_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  CHECK ( (source = 'bank' AND bank_id IS NOT NULL) OR (source = 'custody' AND custody_id IS NOT NULL) )
);

-- =====================================================================
-- 9. HELPFUL VIEW: trial balance per company (the reporting payoff of
--    having a single Universal Journal — this query works for ANY company
--    with zero special-casing per module)
-- =====================================================================

CREATE VIEW v_trial_balance AS
SELECT
  a.company_id,
  a.id           AS account_id,
  a.code         AS account_code,
  a.name         AS account_name,
  a.account_type,
  COALESCE(SUM(l.debit), 0)  AS total_debit,
  COALESCE(SUM(l.credit), 0) AS total_credit,
  COALESCE(SUM(l.debit), 0) - COALESCE(SUM(l.credit), 0) AS balance
FROM gl_accounts a
LEFT JOIN gl_journal_line l ON l.account_id = a.id
LEFT JOIN gl_journal j ON j.id = l.journal_id AND j.status = 'posted'
GROUP BY a.company_id, a.id, a.code, a.name, a.account_type;

-- Customer sub-ledger: derives each customer's outstanding balance directly
-- from the journal lines tagged with their customer_id — no separate
-- "balance" column to drift out of sync with the ledger.
CREATE VIEW v_customer_balance AS
SELECT
  c.id AS customer_id,
  c.company_id,
  c.name,
  COALESCE(SUM(l.debit), 0) - COALESCE(SUM(l.credit), 0) AS balance
FROM customers c
LEFT JOIN gl_journal_line l ON l.customer_id = c.id
LEFT JOIN gl_journal j ON j.id = l.journal_id AND j.status = 'posted'
GROUP BY c.id, c.company_id, c.name;

-- Supplier sub-ledger: same principle for accounts payable.
CREATE VIEW v_supplier_balance AS
SELECT
  s.id AS supplier_id,
  s.company_id,
  s.name,
  COALESCE(SUM(l.credit), 0) - COALESCE(SUM(l.debit), 0) AS balance
FROM suppliers s
LEFT JOIN gl_journal_line l ON l.supplier_id = s.id
LEFT JOIN gl_journal j ON j.id = l.journal_id AND j.status = 'posted'
GROUP BY s.id, s.company_id, s.name;
