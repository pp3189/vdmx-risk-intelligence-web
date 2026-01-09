const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');

router.get('/ping', paymentController.ping);
router.get('/health', paymentController.health);
router.post('/webhook/openpay', paymentController.handleOpenpayWebhook);

router.get('/:folio', paymentController.validateFolio);

module.exports = router;