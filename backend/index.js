require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const paymentRoutes = require('./routes/payments');
const formRoutes = require('./routes/forms');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

/**
 * IMPORTANTE: Raw body para webhook de OpenPay
 * Se aplica ANTES de los routers pero DESPUÉS de definir la ruta específica
 */
app.use('/api/payments/webhook/openpay', 
  bodyParser.raw({ type: 'application/json' }),
  (req, res, next) => {
    // Pasar al router de payments
    next();
  }
);

// JSON normal para todo lo demás
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Rutas
app.use('/api/payments', paymentRoutes);
app.use('/api/forms', formRoutes);

// Health
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'VDMX Backend running' });
});

app.listen(PORT, () => {
  console.log(`✅ VDMX Backend running on port ${PORT}`);
});
