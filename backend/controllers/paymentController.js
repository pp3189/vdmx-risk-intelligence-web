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
   — no usado con Checkout —
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
  const signature =
    req.headers['x-openpay-signature'] ||
    req.headers['openpay-signature'];

  const webhookSecret = process.env.OPENPAY_WEBHOOK_SECRET;
  const rawBody = req.body.toString('utf8');

  if (!signature) {
    return res.status(200).json({ received: true });
  }

  const hmac = crypto.createHmac('sha256', webhookSecret);
  hmac.update(rawBody);
  const computedSignature = hmac.digest('hex');

  if (signature !== computedSignature) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const payload = JSON.parse(rawBody);
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

  const newStatus = eventType.includes('charge.succeeded')
    ? 'paid'
    : 'failed';

  db.get(
    'SELECT folio, status FROM payments WHERE folio = ?',
    [folio],
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: 'DB error' });
      }

      if (!row) {
        db.run(
          `
          INSERT INTO payments (
            folio, paquete, monto, status, charge_id
          ) VALUES (?, ?, ?, ?, ?)
        `,
          [folio, 'OpenPay Checkout', amount, newStatus, transactionId],
          () => {
            return res.status(200).json({ received: true, created: true });
          }
        );
      } else {
        db.run(
          `
          UPDATE payments
          SET status = ?, charge_id = ?, updated_at = CURRENT_TIMESTAMP
          WHERE folio = ?
        `,
          [newStatus, transactionId, folio],
          () => {
            return res.status(200).json({ received: true, updated: true });
          }
        );
      }
    }
  );
}; // ← 🔴 ESTA LLAVE ERA LA QUE FALTABA

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

      res.status(200).json({
        valid: row.status === 'paid',
        folio: row.folio,
        status: row.status
      });
    }
  );
};
