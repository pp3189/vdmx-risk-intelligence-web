// ===== routes/payments.js =====
const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');

router.get('/ping', paymentController.ping);
router.get('/health', paymentController.health);

module.exports = router;