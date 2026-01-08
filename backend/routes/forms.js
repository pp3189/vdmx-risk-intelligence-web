// ===== routes/forms.js =====
const express = require('express');
const router = express.Router();
const formController = require('../controllers/formController');

router.get('/ping', formController.ping);
router.get('/health', formController.health);

module.exports = router;