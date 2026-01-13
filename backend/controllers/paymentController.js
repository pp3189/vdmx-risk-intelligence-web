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
   (opcional, NO rompe nada)
========================= */

exports.preRegisterPayment = (req, res) => {
  const { folio, package: packageName, amount } = req.body;

  if (!folio || !packageName || !amount) {
    return res.status(400).json({
      success: false,
      message: 'Folio, package and amount required'
    });
  }

  db.get(
    'SELECT folio FROM payments WHERE folio = ?',
    [folio],
    (err, row) => {
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

      const params = [
        folio,
        packageName,
        amount,
        'pending',
        null,
        null,
        null,
        null,
        null
      ];

      db.run(query, params, function (err) {
        if (err) {
          console.error('❌ Error pre-registering payment:', err.message);
          return res.status(500).json({
            success: false,
            message: 'Error creating pre-registration'
          });
        }

        res.status(200).json({
          success: true,
          folio,
          message: 'Payment pre-registered successfully'
        });
      });
    }
  );
};

/* =========================
   (LEGACY) CREATE PAYMENT
   NO usado con Checkout
========================= */

exports.createPayment = (req, res) => {
  return res.status(410).json({
    success: false,
    message: 'Endpoint deprecated. Use OpenPay Checkout.'
  });
};

/* =========================
   OPENPAY WEBHOOK (CLAVE)
========================= */

exports.handleOpenpayWebhook = (req, res) => {
  const signature =
    req.headers['x-openpay-signature'] ||
    req.headers['openpay-signature'];

  const webhookSecret = process.env.OPENPAY_WEBHOOK_SECRET;
  const payload = req.body;

  // Verificación inicial de OpenPay (cuando agregas el webhook)
  if (!signature) {
    console.log('ℹ️ OpenPay webhook verification request');
    return res.status(200).json({ received: true });
  }

  if (!webhookSecret) {
    console.error('❌ Missing webhook secret');
    return res.status(401).json({ error: 'Missing webhook secret' });
  }

  // Verificar firma HMAC
  const hmac = crypto.createHmac('sha256', webhookSecret);
  hmac.update(JSON.stringify(payload));
  const computedSignature = hmac.digest('hex');

  if (signature !== computedSignature) {
    console.error('❌ Invalid webhook signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const eventType = payload.type || payload.event_type;

  if (
    !eventType ||
    (!eventType.includes('charge.succeeded') &&
     !eventType.includes('charge.failed'))
  ) {
    return res.status(200).json({ received: true });
  }

  const folio = payload.transaction?.order_id;
  const transactionId = payload.transaction?.id;
  const amount = payload.transaction?.amount || 0;
  const description =
    payload.transaction?.description || 'OpenPay Checkout';

  if (!folio) {
    console.error('❌ Webhook without order_id');
    return res.status(200).json({ received: true });
  }

  const newStatus = eventType.includes('charge.succeeded')
    ? 'paid'
    : 'failed';

  console.log(
    `📥 Webhook: ${eventType} | Folio: ${folio} | Amount: ${amount}`
  );

  db.get(
    'SELECT folio, status FROM payments WHERE folio = ?',
    [folio],
    (err, row) => {
      if (err) {
        console.error('❌ DB error:', err.message);
        return res.status(500).json({ error: 'Database error' });
      }

      // NO EXISTE → CREAR
      if (!row) {
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

        const params = [
          folio,
          description,
          amount,
          newStatus,
          transactionId,
          null,
          null,
          null,
          null
        ];

        db.run(insertQuery, params, function (insertErr) {
          if (insertErr) {
            console.error('❌ Insert error:', insertErr.message);
            return res.status(500).json({ error: 'Insert error' });
          }

          console.log(`✅ Payment created: ${folio} (${newStatus})`);

          return res.status(200).json({
            received: true,
            folio,
            status: newStatus,
            created: true
          });
        });
      }
      // EXISTE → ACTUALIZAR
      else {
        if (row.status === newStatus) {
          return res.status(200).json({
            received: true,
            folio,
            status: newStatus,
            message: 'Already processed'
          });
        }

        const updateQuery = `
          UPDATE payments
          SET status = ?, charge_id = ?, updated_at = CURRENT_TIMESTAMP
          WHERE folio = ?
        `;

        db.run(
          updateQuery,
          [newStatus, transactionId, folio],
          function (updateErr) {
            if (updateErr) {
              console.error('❌ Update error:', updateErr.message);
              return res.status(500).json({ error: 'Update error' });
            }

            console.log(`🔄 Payment updated: ${folio} (${newStatus})`);

            return res.status(200).json({
              received: true,
              folio,
              status: newStatus,
              updated: true
            });
          }
        );
      }
    }
  );
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

  db.get(
    'SELECT folio, status FROM payments WHERE folio = ?',
    [folio],
    (err, row) => {
      if (err) {
        console.error('❌ Validate error:', err.message);
        return res.status(500).json({
          valid: false,
          message: 'Server error'
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
        message: isValid
          ? 'Payment verified'
          : 'Payment not completed'
      });
    }
  );
};
