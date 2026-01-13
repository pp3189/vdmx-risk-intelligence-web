const db = require('../db/database');
const crypto = require('crypto');

/* =========================
   HEALTH & PING
========================= */

const ping = (req, res) => {
  res.json({
    message: 'Payments endpoint operational',
    timestamp: new Date().toISOString()
  });
};

const health = (req, res) => {
  db.get('SELECT COUNT(*) as count FROM payments', (err, row) => {
    if (err) {
      return res.status(500).json({ status: 'error', message: err.message });
    }
    res.json({ status: 'ok', table: 'payments', records: row.count });
  });
};

/* =========================
   PRE-REGISTER (OPCIONAL)
========================= */

const preRegisterPayment = (req, res) => {
  const { folio, package: packageName, amount } = req.body;

  if (!folio || !packageName || !amount) {
    return res.status(400).json({ success: false });
  }

  db.get('SELECT folio FROM payments WHERE folio = ?', [folio], (err, row) => {
    if (err) return res.status(500).json({ success: false });

    if (row) {
      return res.status(200).json({ success: true, folio });
    }

    db.run(
      `INSERT INTO payments (folio, paquete, monto, status)
       VALUES (?, ?, ?, 'pending')`,
      [folio, packageName, amount],
      err => {
        if (err) return res.status(500).json({ success: false });
        res.status(200).json({ success: true, folio });
      }
    );
  });
};

/* =========================
   OPENPAY WEBHOOK (CLAVE)
========================= */

const handleOpenpayWebhook = (req, res) => {
  const rawBody = req.body.toString('utf8');

  const signature =
    req.headers['x-openpay-signature'] ||
    req.headers['openpay-signature'];

  const secret = process.env.OPENPAY_WEBHOOK_SECRET;

  // Verificación inicial de OpenPay
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
  const description = transaction.description || 'OpenPay Checkout';

  console.log(`📥 Webhook OK → ${folio} | ${status}`);

  db.get('SELECT folio FROM payments WHERE folio = ?', [folio], (err, row) => {
    if (err) return res.status(500).json({});

    if (!row) {
      db.run(
        `INSERT INTO payments (folio, paquete, monto, status, charge_id)
         VALUES (?, ?, ?, ?, ?)`,
        [folio, description, amount, status, chargeId]
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

const validateFolio = (req, res) => {
  const folio = req.params.folio;

  db.get('SELECT status FROM payments WHERE folio = ?', [folio], (err, row) => {
    if (!row) {
      return res.status(404).json({ valid: false });
    }

    res.json({
      valid: row.status === 'paid',
      status: row.status
    });
  });
};

/* =========================
   EXPORTS (CRÍTICO)
========================= */

module.exports = {
  ping,
  health,
  preRegisterPayment,
  handleOpenpayWebhook,
  validateFolio
};
