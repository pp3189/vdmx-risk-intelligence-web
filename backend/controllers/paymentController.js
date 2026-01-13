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
  // El body ya viene como Buffer gracias a express.raw() en index.js
  const rawBody = Buffer.isBuffer(req.body) 
    ? req.body.toString('utf8') 
    : JSON.stringify(req.body);

  const signature = req.headers['x-openpay-signature'] || req.headers['openpay-signature'];
  const webhookSecret = process.env.OPENPAY_WEBHOOK_SECRET;

  console.log('📥 Webhook received');
  console.log('Signature:', signature ? 'Present' : 'Missing');
  console.log('Raw body length:', rawBody.length);

  // Verificación inicial (OpenPay envía un request sin firma para verificar la URL)
  if (!signature) {
    console.log('ℹ️  Webhook verification request (no signature)');
    return res.status(200).json({ received: true });
  }

  // Validar que exista el secret
  if (!webhookSecret) {
    console.error('❌ Missing OPENPAY_WEBHOOK_SECRET');
    return res.status(401).json({ error: 'Missing webhook secret' });
  }

  // Validar firma HMAC
  const hmac = crypto.createHmac('sha256', webhookSecret);
  hmac.update(rawBody);
  const computedSignature = hmac.digest('hex');

  if (signature !== computedSignature) {
    console.error('❌ Invalid webhook signature');
    console.error('Expected:', computedSignature);
    console.error('Received:', signature);
    return res.status(401).json({ error: 'Invalid signature' });
  }

  console.log('✅ Signature valid');

  // Parsear payload
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (e) {
    console.error('❌ Error parsing webhook payload:', e.message);
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const eventType = payload.type || payload.event_type;
  const transaction = payload.transaction;

  console.log('Event type:', eventType);
  console.log('Transaction:', transaction ? 'Present' : 'Missing');

  // Filtrar solo eventos relevantes
  if (!eventType || (!eventType.includes('charge.succeeded') && !eventType.includes('charge.failed'))) {
    console.log(`ℹ️  Ignoring event: ${eventType}`);
    return res.status(200).json({ received: true, message: 'Event ignored' });
  }

  if (!transaction || !transaction.order_id) {
    console.error('❌ Webhook without transaction or order_id');
    return res.status(200).json({ received: true, message: 'No transaction data' });
  }

  const folio = transaction.order_id;
  const transactionId = transaction.id;
  const amount = transaction.amount || 0;
  const description = transaction.description || 'OpenPay Checkout';
  const newStatus = eventType.includes('charge.succeeded') ? 'paid' : 'failed';

  console.log(`📥 Webhook: ${eventType} | Folio: ${folio} | Status: ${newStatus} | Amount: ${amount}`);

  // Verificar si el folio existe
  db.get('SELECT folio, status FROM payments WHERE folio = ?', [folio], (err, row) => {
    if (err) {
      console.error('❌ DB error checking folio:', err.message);
      return res.status(500).json({ error: 'Database error' });
    }

    // CASO 1: Folio NO existe → INSERT
    if (!row) {
      console.log(`🆕 Payment created: ${folio} | Status: ${newStatus}`);

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

      db.run(
        insertQuery,
        [folio, description, amount, newStatus, transactionId, null, null, null, null],
        function (insertErr) {
          if (insertErr) {
            console.error('❌ Error creating payment:', insertErr.message);
            return res.status(500).json({ error: 'Insert error' });
          }

          console.log(`✅ Payment inserted: ${folio} | Transaction: ${transactionId}`);
          return res.status(200).json({
            received: true,
            folio,
            status: newStatus,
            created: true
          });
        }
      );
    }
    // CASO 2: Folio YA existe → UPDATE
    else {
      // Idempotencia
      if (row.status === newStatus) {
        console.log(`ℹ️  Payment already has status ${newStatus}: ${folio}`);
        return res.status(200).json({
          received: true,
          folio,
          status: newStatus,
          message: 'Already processed'
        });
      }

      console.log(`🔄 Payment updated: ${folio} | ${row.status} → ${newStatus}`);

      const updateQuery = `
        UPDATE payments
        SET status = ?, charge_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE folio = ?
      `;

      db.run(updateQuery, [newStatus, transactionId, folio], function (updateErr) {
        if (updateErr) {
          console.error('❌ Error updating payment:', updateErr.message);
          return res.status(500).json({ error: 'Update error' });
        }

        console.log(`✅ Payment updated: ${folio} | Transaction: ${transactionId}`);
        return res.status(200).json({
          received: true,
          folio,
          status: newStatus,
          updated: true
        });
      });
    }
  });
};

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
