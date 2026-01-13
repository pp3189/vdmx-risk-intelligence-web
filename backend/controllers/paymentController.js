const db = require('../db/database');
const crypto = require('crypto');

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

exports.preRegisterPayment = (req, res) => {
  const { folio, package: packageName, amount } = req.body;
  
  if (!folio || !packageName || !amount) {
    return res.status(400).json({ 
      success: false, 
      message: 'Folio, package and amount required' 
    });
  }

  // Verificar si el folio ya existe
  db.get('SELECT folio FROM payments WHERE folio = ?', [folio], (err, row) => {
    if (err) {
      console.error('❌ Error checking folio:', err.message);
      return res.status(500).json({ 
        success: false, 
        message: 'Database error' 
      });
    }

    // Si ya existe, responder OK sin duplicar
    if (row) {
      console.log(`ℹ️  Folio already exists: ${folio}`);
      return res.status(200).json({ 
        success: true,
        folio: folio,
        message: 'Payment already pre-registered'
      });
    }

    // Insertar pre-registro
    const query = `
      INSERT INTO payments (
        folio, 
        paquete, 
        monto, 
        status, 
        charge_id,
        landlord_name, 
        landlord_email, 
        tenant_name, 
        tenant_email
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [folio, packageName, amount, 'pending', null, null, null, null, null];

    db.run(query, params, function(err) {
      if (err) {
        console.error('❌ Error pre-registering payment:', err.message);
        return res.status(500).json({ 
          success: false, 
          message: 'Error creating pre-registration' 
        });
      }

      console.log(`✅ Payment pre-registered: ${folio} | Package: ${packageName} | Amount: ${amount}`);
      
      res.status(200).json({ 
        success: true,
        folio: folio,
        message: 'Payment pre-registered successfully'
      });
    });
  });
};

exports.createPayment = (req, res) => {
  const { package: packageName, amount, order_id } = req.body;
  
if (!packageName || !amount || !order_id) {
  return res.status(400).json({ 
    success: false, 
    message: 'Package, amount and order_id required' 
  });
}

  const folio = order_id;
  const query = `
    INSERT INTO payments (
      folio, 
      paquete, 
      monto, 
      status, 
      charge_id,
      landlord_name, 
      landlord_email, 
      tenant_name, 
      tenant_email
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const params = [folio, packageName, amount, 'pending', null, null, null, null, null];

  db.run(query, params, function(err) {
    if (err) {
      console.error('❌ Error creating payment:', err.message);
      return res.status(500).json({ 
        success: false, 
        message: 'Error creating payment' 
      });
    }

    const Openpay = require('openpay');
    const openpay = new Openpay(
      process.env.OPENPAY_MERCHANT_ID, 
      process.env.OPENPAY_PRIVATE_KEY
    );
    openpay.setProductionReady(process.env.OPENPAY_PRODUCTION === 'true');

  const chargeRequest = {
  source_id: token_id,
  method: 'card',
  amount: amount,
  description: `${packageName} - VDMX Risk Intelligence`,
  order_id: folio,
  use_3d_secure: true,
  currency: 'MXN'
};

    openpay.charges.create(chargeRequest, function(error, charge) {
      if (error) {
        console.error('❌ Error creating Openpay charge');
        console.error('Error Code:', error.error_code);
        console.error('Description:', error.description);
        console.error('HTTP Code:', error.http_code);
        console.error('Request ID:', error.request_id);
        console.error('Full error:', JSON.stringify(error, null, 2));
        
        db.run(
          'UPDATE payments SET status = ? WHERE folio = ?',
          ['failed', folio],
          () => {}
        );
        
        return res.status(500).json({ 
          success: false, 
          message: error.description || 'Error generating checkout',
          error_code: error.error_code
        });
      }

      if (!charge || !charge.id) {
  console.error('❌ Invalid charge response from OpenPay');
  console.error('Charge object:', JSON.stringify(charge, null, 2));
  
  db.run(
    'UPDATE payments SET status = ? WHERE folio = ?',
    ['failed', folio],
    () => {}
  );
  
  return res.status(500).json({ 
    success: false, 
    message: 'Invalid response from payment gateway'
  });
}

      db.run(
        'UPDATE payments SET charge_id = ? WHERE folio = ?',
        [charge.id, folio],
        (updateErr) => {
          if (updateErr) {
            console.error('⚠️ Error updating charge_id:', updateErr.message);
          }
        }
      );

     console.log(`✅ Payment created: ${folio} | Charge: ${charge.id}`);
      
const response = { 
  success: true,
  folio: folio,
  charge_id: charge.id,
  status: charge.status
};

if (charge.payment_method && charge.payment_method.url) {
  response.redirect_3ds_url = charge.payment_method.url;
  console.log(`🔒 3DS required: ${charge.payment_method.url}`);
}

res.status(200).json(response);
    });
  });
};
      
exports.handleOpenpayWebhook = (req, res) => {
  const signature = req.headers['x-openpay-signature'] || req.headers['openpay-signature'];
  const webhookSecret = process.env.OPENPAY_WEBHOOK_SECRET;

  const rawBody = req.body.toString('utf8');

  if (!signature) {
    console.log('ℹ️  Webhook verification request (no signature)');
    
    try {
      const payload = JSON.parse(rawBody);
      const verificationCode = payload.verification_code || payload.code || payload.pin;
      
      if (verificationCode) {
        console.log('🔐 OpenPay verification code:', verificationCode);
      } else {
        console.log('📦 Verification payload:', payload);
      }
    } catch (e) {
      console.log('⚠️  Could not parse verification payload');
    }
    
    return res.status(200).json({ 
      received: true, 
      message: 'Webhook verified' 
    });
  }

  if (!webhookSecret) {
    console.error('❌ Missing webhook secret');
    return res.status(401).json({ 
      error: 'Unauthorized',
      message: 'Missing webhook secret' 
    });
  }

  const hmac = crypto.createHmac('sha256', webhookSecret);
  hmac.update(rawBody);
  const computedSignature = hmac.digest('hex');

  if (signature !== computedSignature) {
    console.error('❌ Invalid webhook signature');
    console.error(`Expected: ${computedSignature}`);
    console.error(`Received: ${signature}`);
    return res.status(401).json({ 
      error: 'Unauthorized',
      message: 'Invalid signature' 
    });
  }

  const payload = JSON.parse(rawBody);
  const eventType = payload.type || payload.event_type;
  
  if (!eventType || (!eventType.includes('charge.succeeded') && !eventType.includes('charge.failed'))) {
    return res.status(200).json({ 
      received: true, 
      message: 'Event ignored' 
    });
  }

  const folio = payload.transaction?.order_id || null;
  const transactionId = payload.transaction?.id || payload.id || 'unknown';

  if (!folio) {
    console.error('❌ Webhook without order_id (folio)');
    return res.status(200).json({ 
      received: true, 
      message: 'No order_id provided' 
    });
  }

  const newStatus = eventType.includes('charge.succeeded') ? 'paid' : 'failed';

// Primero verificar si el folio existe
db.get('SELECT folio, status FROM payments WHERE folio = ?', [folio], (err, row) => {
  if (err) {
    console.error('❌ Error checking folio:', err.message);
    return res.status(500).json({ 
      error: 'Database error',
      message: err.message 
    });
  }

  // Si el folio NO existe, crearlo
  if (!row) {
    console.log(`ℹ️  Folio not found, creating new payment: ${folio}`);
    
    const insertQuery = `
      INSERT INTO payments (
        folio, 
        paquete, 
        monto, 
        status, 
        charge_id,
        landlord_name, 
        landlord_email, 
        tenant_name, 
        tenant_email
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const amount = payload.transaction?.amount || 0;
    const description = payload.transaction?.description || 'Pago OpenPay Checkout';
    const params = [folio, description, amount, newStatus, transactionId, null, null, null, null];

    db.run(insertQuery, params, function(insertErr) {
      if (insertErr) {
        console.error('❌ Error creating payment:', insertErr.message);
        return res.status(500).json({ 
          error: 'Database error',
          message: insertErr.message 
        });
      }

      console.log(`✅ Payment created from webhook: ${folio} | Status: ${newStatus} | Transaction: ${transactionId}`);
      
      return res.status(200).json({ 
        received: true,
        folio: folio,
        status: newStatus,
        transaction_id: transactionId,
        created: true
      });
    });
  } 
  // Si el folio existe, actualizarlo (solo si está pending o si el estado cambia)
  else {
    if (row.status === newStatus) {
      console.log(`ℹ️  Folio already processed with same status: ${folio} | Status: ${newStatus}`);
      return res.status(200).json({ 
        received: true,
        folio: folio,
        status: newStatus,
        message: 'Already processed'
      });
    }

    const updateQuery = `
      UPDATE payments 
      SET status = ?, charge_id = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE folio = ?
    `;

    db.run(updateQuery, [newStatus, transactionId, folio], function(updateErr) {
      if (updateErr) {
        console.error('❌ Error updating payment:', updateErr.message);
        return res.status(500).json({ 
          error: 'Database error',
          message: updateErr.message 
        });
      }

      console.log(`✅ Payment updated: ${folio} | Status: ${newStatus} | Transaction: ${transactionId}`);
      
      return res.status(200).json({ 
        received: true,
        folio: folio,
        status: newStatus,
        transaction_id: transactionId,
        updated: true
      });
    });
  }
});

exports.validateFolio = (req, res) => {
  const rawFolio = req.params.folio || '';
  const folio = rawFolio.trim().replace(/[\n\r\s]+/g, '');
  
  console.log('🔎 Folio recibido:', JSON.stringify(folio));

  if (!folio || folio === '') {
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

    const isValid = row.status === 'paid';

    res.status(200).json({ 
      valid: isValid, 
      folio: row.folio, 
      status: row.status,
      message: isValid ? 'Payment verified' : 'Payment not completed'
    });
  });
};
