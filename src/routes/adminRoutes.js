const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { isAuthenticated, isAdmin } = require('../middleware/auth');

router.get('/audit-logs', isAuthenticated, isAdmin, adminController.getAuditLogs);

module.exports = router;