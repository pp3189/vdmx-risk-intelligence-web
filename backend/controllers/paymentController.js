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

exports.createPayment = (req, res) => {
  const { package: packageName, amount } = req.body;
  
  if (!packageName || !amount) {
    return res.status(400).json({ 
      success: false, 
      message: 'Package and amount required' 
    });
  }

  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  const folio = `OP-${timestamp}-${random}`;

  const query = `
    INSERT INTO payments (
      folio, 
      package, 
      amount, 
      status, 
      landlord_name, 
      landlord_email, 
      tenant_name, 
      tenant_email
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const params = [folio, packageName, amount, 'pending', null, null, null, null];

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
      method: 'card',
      amount: amount,
      description: `${packageName} - VDMX Risk Intelligence`,
      order_id: folio,
      redirect_url: `${process.env.FRONTEND_URL}/automotriz-pago-confirmacion.html?folio=${folio}`,
      use_card_points: false,
      send_email: false
    };

    openpay.charges.create(chargeRequest, function(error, charge) {
      if (error) {
        console.error('❌ Error creating Openpay charge:', error);
        
        db.run(
          'UPDATE payments SET status = ? WHERE folio = ?',
          ['failed', folio],
          () => {}
        );
        
        return res.status(500).json({ 
          success: false, 
          message: 'Error generating checkout' 
        });
      }

      console.log(`✅ Payment created: ${folio} | Charge: ${charge.id}`);
      
      res.status(200).json({ 
        success: true,
        folio: folio,
        checkout_url: charge.payment_method.url
      });
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

  const query = 'UPDATE payments SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE folio = ? AND status = ?';

  db.run(query, [newStatus, folio, 'pending'], function(err) {
    if (err) {
      console.error('❌ Error updating payment:', err.message);
      return res.status(500).json({ 
        error: 'Database error',
        message: err.message 
      });
    }

    if (this.changes === 0) {
      console.warn(`⚠️  Folio not found or already processed: ${folio}`);
      return res.status(200).json({ 
        received: true, 
        message: 'Folio not found or already processed' 
      });
    }

    console.log(`✅ Payment updated: ${folio} | Status: ${newStatus} | Transaction: ${transactionId}`);
    
    res.status(200).json({ 
      received: true,
      folio: folio,
      status: newStatus,
      transaction_id: transactionId
    });
  });
};

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
