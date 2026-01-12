// ===== db/database.js =====
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'vdmx.db');
const schemaPath = path.join(__dirname, 'schema.sql');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('❌ Error connecting to database:', err.message);
  } else {
    console.log('✅ Connected to SQLite database');
    initializeDatabase();
  }
});

function initializeDatabase() {
  const schema = fs.readFileSync(schemaPath, 'utf8');
  
  db.exec(schema, (err) => {
    if (err) {
      console.error('❌ Error initializing database:', err.message);
    } else {
      console.log('✅ Database schema initialized');
      runMigrations();
    }
  });
}

function runMigrations() {
  // Migración: Agregar columna charge_id si no existe
  db.all("PRAGMA table_info(payments)", (err, columns) => {
    if (err) {
      console.error('❌ Error checking payments table:', err.message);
      return;
    }

    const hasChargeId = columns.some(col => col.name === 'charge_id');

    if (!hasChargeId) {
      console.log('🔧 Running migration: Adding charge_id column...');
      db.run('ALTER TABLE payments ADD COLUMN charge_id TEXT', (alterErr) => {
        if (alterErr) {
          console.error('❌ Error adding charge_id column:', alterErr.message);
        } else {
          console.log('✅ Migration completed: charge_id column added');
        }
      });
    } else {
      console.log('✅ Database up to date (charge_id column exists)');
    }
  });
}

module.exports = db;
