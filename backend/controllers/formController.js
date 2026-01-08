// ===== controllers/formController.js =====
const db = require('../db/database');

exports.ping = (req, res) => {
  res.json({ 
    message: 'Forms endpoint operational',
    timestamp: new Date().toISOString()
  });
};

exports.health = (req, res) => {
  db.get('SELECT COUNT(*) as count FROM forms', (err, row) => {
    if (err) {
      return res.status(500).json({ 
        status: 'error', 
        message: err.message 
      });
    }
    res.json({ 
      status: 'ok',
      table: 'forms',
      records: row.count
    });
  });
};