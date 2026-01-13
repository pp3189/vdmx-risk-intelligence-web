require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const paymentRoutes = require('./routes/payments');
const formRoutes = require('./routes/forms');
const paymentController = require('./controllers/paymentController');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

/**
 * 🔒 WEBHOOK OPENPAY
 * DEBE ir ANTES de bodyParser.json
 * DEBE usar raw
 */
app.post(
  '/api/payments/webhook/openpay',
  bodyParser.raw({ type: 'application/json' }),
  paymentController.handleOpenpayWebhook
);

/**
 * ✅ JSON para el resto del backend
 */
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use('/api/payments', paymentRoutes);
app.use('/api/forms', formRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'VDMX Backend running' });
});

app.listen(PORT, () => {
  console.log(`✅ VDMX Backend running on port ${PORT}`);
});
