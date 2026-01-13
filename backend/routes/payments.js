const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');

// Health checks
router.get('/ping', paymentController.ping);
router.get('/health', paymentController.health);

// Payment operations
router.post('/create', paymentController.createPayment);
router.post('/pre-register', paymentController.preRegisterPayment);

// Webhook - LA RUTA SE MANEJA EN index.js CON express.raw()
// NO definir aquí para evitar conflictos
router.post('/webhook/openpay', paymentController.handleOpenpayWebhook);

// Validate folio
router.get('/:folio', paymentController.validateFolio);

module.exports = router;
