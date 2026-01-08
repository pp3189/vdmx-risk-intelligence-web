-- ===== db/schema.sql =====
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  folio TEXT UNIQUE NOT NULL,
  paquete TEXT NOT NULL,
  monto REAL NOT NULL,
  status TEXT DEFAULT 'pending',
  landlord_name TEXT,
  landlord_email TEXT,
  tenant_name TEXT,
  tenant_email TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS forms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  folio TEXT NOT NULL,
  form_type TEXT NOT NULL,
  data TEXT,
  status TEXT DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payments_folio ON payments(folio);
CREATE INDEX IF NOT EXISTS idx_forms_folio ON forms(folio);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_forms_status ON forms(status);