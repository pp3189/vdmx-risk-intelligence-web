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
      return res.status(500).json({ status: 'error', message: err.message });
    }
    res.json({ status: 'ok', table: 'payments', records: row.count });
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
      console.error('❌ DB error:', err.message);
      return res.status(500).json({ success: false, message: 'Database error' });
    }

    if (row) {
      return res.status(200).json({ success: true, folio });
    }

    db.run(
      `INSERT INTO payments (folio, paquete, monto, status)
       VALUES (?, ?, ?, 'pending')`,
      [folio, packageName, amount],
      err => {
        if (err) {
          console.error('❌ Insert error:', err.message);
          return res.status(500).json({ success: false });
        }
        res.status(200).json({ success: true, folio });
      }
    );
  });
};

/* =========================
   OPENPAY WEBHOOK (FINAL)
========================= */

exports.handleOpenpayWebhook = (req, res) => {
  const rawBody = req.body.toString('utf8');
  const signature =
    req.headers['x-openpay-signature'] ||
    req.headers['openpay-signature'];

  const secret = process.env.OPENPAY_WEBHOOK_SECRET;

  if (!signature) {
    console.log('ℹ️ OpenPay webhook verification');
    return res.status(200).json({ received: true });
  }

  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(rawBody);
  const expected = hmac.digest('hex');

  if (signature !== expected) {
    console.error('❌ Invalid webhook signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const payload = JSON.parse(rawBody);
  const eventType = payload.type;
  const transaction = payload.transaction;

  if (!transaction || !transaction.order_id) {
    return res.status(200).json({ received: true });
  }

  const folio = transaction.order_id;
  const status = eventType === 'charge.succeeded' ? 'paid' : 'failed';
  const amount = transaction.amount;
  const chargeId = transaction.id;

  console.log(`📥 Webhook OK → ${folio} | ${status}`);

  db.get('SELECT folio FROM payments WHERE folio = ?', [folio], (err, row) => {
    if (err) return res.status(500).json({});

    if (!row) {
      db.run(
        `INSERT INTO payments (folio, paquete, monto, status, charge_id)
         VALUES (?, ?, ?, ?, ?)`,
        [folio, transaction.description, amount, status, chargeId]
      );
    } else {
      db.run(
        `UPDATE payments
         SET status = ?, charge_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE folio = ?`,
        [status, chargeId, folio]
      );
    }

    res.status(200).json({ received: true });
  });
};

/* =========================
   VALIDATE FOLIO
========================= */

exports.validateFolio = (req, res) => {
  const folio = req.params.folio;

  db.get('SELECT status FROM payments WHERE folio = ?', [folio], (err, row) => {
    if (!row) {
      return res.status(404).json({ valid: false, message: 'Folio no encontrado' });
    }

    res.json({
      valid: row.status === 'paid',
      status: row.status
    });
  });
};
