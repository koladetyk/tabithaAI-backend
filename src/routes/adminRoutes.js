const adminController = require('../controllers/adminController');
router.get('/audit-logs', isAuthenticated, isAdmin, adminController.getAuditLogs);