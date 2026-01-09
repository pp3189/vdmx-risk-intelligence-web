const db = require('../db/database');

exports.ping = (req, res) => {
  res.json({ 
    message: 'Payments endpoint operational',
    timestamp: new Date().toISOString()
  });
};

exports.health = (req, res) => {
  db.get('SELECT COUNT(*) as count FROM payments', (err, row) => {
    if (err) {
      return res.status(500).json({ 
        status: 'error', 
        message: err.message 
      });
    }
    res.json({ 
      status: 'ok',
      table: 'payments',
      records: row.count
    });
  });
};

exports.handleOpenpayWebhook = (req, res) => {
  const payload = req.body;
  
  const eventType = payload.type || payload.event_type;
  
  if (!eventType || !eventType.includes('charge.succeeded')) {
    return res.status(200).json({ 
      received: true, 
      message: 'Event ignored' 
    });
  }

  const transactionId = payload.transaction?.id || payload.id || 'unknown';
  const amount = payload.transaction?.amount || payload.amount || 0;
  const description = payload.transaction?.description || payload.description || '';

  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  const folio = `OP-${timestamp}-${random}`;

  const query = `
    INSERT INTO payments (
      folio, 
      paquete, 
      monto, 
      status, 
      landlord_name, 
      landlord_email, 
      tenant_name, 
      tenant_email
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const params = [
    folio,
    description || 'N/A',
    amount,
    'CREADO',
    null,
    null,
    null,
    null
  ];

  db.run(query, params, function(err) {
    if (err) {
      console.error('❌ Error inserting payment:', err.message);
      return res.status(500).json({ 
        error: 'Database error',
        message: err.message 
      });
    }

    console.log(`✅ Payment registered: ${folio} | Transaction: ${transactionId} | Amount: ${amount}`);
    
    res.status(200).json({ 
      received: true,
      folio: folio,
      transaction_id: transactionId,
      amount: amount
    });
  });
};
exports.validateFolio = (req, res) => {
  const folio = req.params.folio.trim();
  
console.log('🔎 Folio recibido:', JSON.stringify(folio));

  if (!folio || folio.trim() === '') {
    return res.status(400).json({ 
      valid: false, 
      message: 'Folio requerido' 
    });
  }

  const query = 'SELECT folio, status FROM payments WHERE folio = ?';
  
  db.get(query, [folio], (err, row) => {
    if (err) {
      console.error('❌ Error validating folio:', err.message);
      return res.status(500).json({ 
        valid: false, 
        message: 'Error del servidor' 
      });
    }

    if (!row) {
      return res.status(404).json({ 
        valid: false, 
        message: 'Folio no encontrado' 
      });
    }

    res.status(200).json({ 
      valid: true, 
      folio: row.folio, 
      status: row.status 
    });
  });
};