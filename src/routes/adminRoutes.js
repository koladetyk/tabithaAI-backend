const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { isAuthenticated } = require('../middleware/auth');
const { isAdmin, isMasterAdmin } = require('../middleware/roleChecks');

// Route: Get audit logs — accessible to any admin
router.get('/audit-logs', isAuthenticated, isAdmin, adminController.getAuditLogs);

// Route: Promote user to admin — any admin can do this
router.post('/promote/:email', isAuthenticated, isAdmin, adminController.promoteToAdmin);

// Route: Demote admin — only master admin can do this
router.post('/demote/:email', isAuthenticated, isMasterAdmin, adminController.demoteAdmin);

router.get('/dashboard-stats', isAuthenticated, isAdmin, adminController.getDashboardStats);

module.exports = router;