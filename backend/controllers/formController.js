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

exports.saveAutomotriz = (req, res) => {
  const folio = req.body.folio ? req.body.folio.trim() : '';
const formData = req.body.formData;
  
  if (!folio || !formData) {
    return res.status(400).json({ 
      success: false, 
      message: 'Folio y datos requeridos' 
    });
  }

  const query = `
    INSERT INTO forms (folio, form_type, data, status) 
    VALUES (?, ?, ?, ?)
  `;

  const dataString = JSON.stringify(formData);
  const params = [folio, 'automotriz', dataString, 'RECIBIDO'];

  db.run(query, params, function(err) {
    if (err) {
      console.error('❌ Error saving form:', err.message);
      return res.status(500).json({ 
        success: false, 
        message: 'Error al guardar solicitud' 
      });
    }

    console.log(`✅ Form saved: ${folio} | ID: ${this.lastID}`);
    
    res.status(200).json({ 
      success: true,
      folio: folio,
      id: this.lastID
    });
  });
};