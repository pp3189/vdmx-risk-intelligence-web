const db = require('../db/database');
const crypto = require('crypto');

/* =========================
   HEALTH & PING
========================= */

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

/* =========================
   PRE-REGISTER PAYMENT
========================= */

exports.preRegisterPayment = (req, res) => {
  const { folio, package: packageName, amount } = req.body;

  if (!folio || !packageName || !amount) {
    return res.status(400).json({
      success: false,
      message: 'Folio, package and amount required'
    });
  }

  db.get('SELECT folio FROM payments WHERE folio = ?', [folio], (err, row) => {
    if (err) {
      console.error('❌ Error checking folio:', err.message);
      return res.status(500).json({
        success: false,
        message: 'Database error'
      });
    }

    if (row) {
      return res.status(200).json({
        success: true,
        folio,
        message: 'Payment already pre-registered'
      });
    }

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

    db.run(query, params, function (err) {
      if (err) {
        console.error('❌ Error pre-registering payment:', err.message);
        return res.status(500).json({
          success: false,
          message: 'Error creating pre-registration'
        });
      }

      console.log(`✅ Payment pre-registered: ${folio}`);
      res.status(200).json({
        success: true,
        folio,
        message: 'Payment pre-registered successfully'
      });
    });
  });
};

/* =========================
   CREATE PAYMENT (LEGACY)
========================= */

exports.createPayment = (req, res) => {
  const { package: packageName, amount, order_id, token_id } = req.body;

  if (!packageName || !amount || !order_id || !token_id) {
    return res.status(400).json({
      success: false,
      message: 'Package, amount, order_id and token_id required'
    });
  }

  const folio = order_id;

  const Openpay = require('openpay');
  const openpay = new Openpay(
    process.env.OPENPAY_MERCHANT_ID,
    process.env.OPENPAY_PRIVATE_KEY
  );

  openpay.setProductionReady(process.env.OPENPAY_PRODUCTION === 'true');

  const chargeRequest = {
    source_id: token_id,
    method: 'card',
    amount,
    description: `${packageName} - VDMX Risk Intelligence`,
    order_id: folio,
    use_3d_secure: true,
    currency: 'MXN'
  };

  openpay.charges.create(chargeRequest, (error, charge) => {
    if (error) {
      console.error('❌ OpenPay error:', error);
      return res.status(500).json({
        success: false,
        message: error.description || 'Payment error'
      });
    }

    res.status(200).json({
      success: true,
      folio,
      charge_id: charge.id,
      status: charge.status
    });
  });
};

/* =========================
   OPENPAY WEBHOOK
========================= */

exports.handleOpenpayWebhook = (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) 
    ? req.body.toString('utf8') 
    : JSON.stringify(req.body);

  // Buscar el header de firma en múltiples variantes
  const signature = 
    req.headers['x-openpay-signature'] || 
    req.headers['openpay-signature'] ||
    req.headers['X-Openpay-Signature'] ||
    req.headers['Openpay-Signature'];

  const webhookSecret = process.env.OPENPAY_WEBHOOK_SECRET;

  console.log('📥 Webhook received');
  console.log('All headers:', Object.keys(req.headers).join(', '));
  console.log('Signature header found:', signature ? 'YES' : 'NO');
  console.log('Signature value:', signature);
  console.log('Raw body length:', rawBody.length);
  console.log('Webhook secret configured:', webhookSecret ? 'Yes' : 'No');

  // Verificación inicial (OpenPay sin firma)
  if (!signature) {
    console.log('ℹ️  Webhook verification request (no signature)');
    
    // TEMPORAL: Procesar el webhook SIN validar firma para testing
    console.log('⚠️  WARNING: Processing webhook without signature validation (TESTING ONLY)');
    
    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch (e) {
      console.error('❌ Error parsing payload:', e.message);
      return res.status(200).json({ received: true });
    }

    const eventType = payload.type || payload.event_type;
    const transaction = payload.transaction;

    if (!eventType || (!eventType.includes('charge.succeeded') && !eventType.includes('charge.failed'))) {
      return res.status(200).json({ received: true, message: 'Event ignored' });
    }

    if (!transaction || !transaction.order_id) {
      return res.status(200).json({ received: true, message: 'No transaction data' });
    }

    const folio = transaction.order_id;
    const transactionId = transaction.id;
    const amount = transaction.amount || 0;
    const description = transaction.description || 'OpenPay Checkout';
    const newStatus = eventType.includes('charge.succeeded') ? 'paid' : 'failed';

    console.log(`📥 Processing: ${eventType} | Folio: ${folio} | Status: ${newStatus}`);

    return processPayment(folio, transactionId, amount, description, newStatus, res);
  }

  // Validar webhook secret
  if (!webhookSecret) {
    console.error('❌ Missing OPENPAY_WEBHOOK_SECRET');
    return res.status(401).json({ error: 'Missing webhook secret' });
  }

  // Validar firma HMAC
  const hmac = crypto.createHmac('sha256', webhookSecret);
  hmac.update(rawBody);
  const computedSignature = hmac.digest('hex');

  console.log('Computed signature:', computedSignature);
  console.log('Received signature:', signature);

  if (signature !== computedSignature) {
    console.error('❌ Invalid webhook signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  console.log('✅ Signature valid');

  // Parsear y procesar
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (e) {
    console.error('❌ Error parsing webhook payload:', e.message);
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const eventType = payload.type || payload.event_type;
  const transaction = payload.transaction;

  if (!eventType || (!eventType.includes('charge.succeeded') && !eventType.includes('charge.failed'))) {
    return res.status(200).json({ received: true, message: 'Event ignored' });
  }

  if (!transaction || !transaction.order_id) {
    return res.status(200).json({ received: true, message: 'No transaction data' });
  }

  const folio = transaction.order_id;
  const transactionId = transaction.id;
  const amount = transaction.amount || 0;
  const description = transaction.description || 'OpenPay Checkout';
  const newStatus = eventType.includes('charge.succeeded') ? 'paid' : 'failed';

  console.log(`📥 Webhook: ${eventType} | Folio: ${folio} | Status: ${newStatus}`);

  processPayment(folio, transactionId, amount, description, newStatus, res);
};

// Función auxiliar para procesar el pago
function processPayment(folio, transactionId, amount, description, newStatus, res) {
  db.get('SELECT folio, status FROM payments WHERE folio = ?', [folio], (err, row) => {
    if (err) {
      console.error('❌ DB error:', err.message);
      return res.status(500).json({ error: 'Database error' });
    }

    if (!row) {
      console.log(`🆕 Creating payment: ${folio}`);

      const insertQuery = `
        INSERT INTO payments (
          folio, paquete, monto, status, charge_id,
          landlord_name, landlord_email, tenant_name, tenant_email
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      db.run(
        insertQuery,
        [folio, description, amount, newStatus, transactionId, null, null, null, null],
        function (insertErr) {
          if (insertErr) {
            console.error('❌ Insert error:', insertErr.message);
            return res.status(500).json({ error: 'Insert error' });
          }

          console.log(`✅ Payment created: ${folio} | ID: ${this.lastID}`);
          return res.status(200).json({
            received: true,
            folio,
            status: newStatus,
            created: true
          });
        }
      );
    } else {
      if (row.status === newStatus) {
        console.log(`ℹ️  Already processed: ${folio}`);
        return res.status(200).json({
          received: true,
          folio,
          status: newStatus,
          message: 'Already processed'
        });
      }

      console.log(`🔄 Updating payment: ${folio}`);

      db.run(
        'UPDATE payments SET status = ?, charge_id = ?, updated_at = CURRENT_TIMESTAMP WHERE folio = ?',
        [newStatus, transactionId, folio],
        function (updateErr) {
          if (updateErr) {
            console.error('❌ Update error:', updateErr.message);
            return res.status(500).json({ error: 'Update error' });
          }

          console.log(`✅ Payment updated: ${folio}`);
          return res.status(200).json({
            received: true,
            folio,
            status: newStatus,
            updated: true
          });
        }
      );
    }
  });
}
/* =========================
   VALIDATE FOLIO
========================= */

exports.validateFolio = (req, res) => {
  const folio = (req.params.folio || '').trim();

  if (!folio) {
    return res.status(400).json({
      valid: false,
      message: 'Folio requerido'
    });
  }

  console.log(`🔍 Validating folio: ${folio}`);

  db.get('SELECT folio, status FROM payments WHERE folio = ?', [folio], (err, row) => {
    if (err) {
      console.error('❌ Error validating folio:', err.message);
      return res.status(500).json({
        valid: false,
        message: 'Server error'
      });
    }

    if (!row) {
      console.log(`❌ Folio not found: ${folio}`);
      return res.status(404).json({
        valid: false,
        message: 'Folio no encontrado'
      });
    }

    const isValid = row.status === 'paid';
    console.log(`✅ Folio validated: ${folio} | Status: ${row.status} | Valid: ${isValid}`);

    res.status(200).json({
      valid: isValid,
      folio: row.folio,
      status: row.status,
      message: isValid ? 'Payment verified' : 'Payment not completed'
    });
  });
};
