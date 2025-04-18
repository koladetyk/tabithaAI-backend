const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const { isAuthenticated, isAdmin } = require('../middleware/auth');
const fileUpload = require('../middleware/fileUpload');

// Get all reports (admin only)
router.get('/', isAuthenticated, isAdmin, reportController.getAllReports);

// Get reports by email for guest users (no authentication required)
router.get('/guest/email/:email', reportController.getGuestReportsByEmail);

// Get reports by user ID
router.get('/user/:userId', isAuthenticated, reportController.getReportsByUserId);

// Reanalyze a report with enhanced AI
router.post('/:id/reanalyze', isAuthenticated, reportController.reanalyzeReport);

// Get individual report by ID
router.get('/:id', isAuthenticated, reportController.getReportById);

// Create new report with file upload support
router.post('/', isAuthenticated, fileUpload.multiple, reportController.createReport);

// Update report
router.put('/:id', isAuthenticated, reportController.updateReport);

// Update report status
router.patch('/:id/status', isAuthenticated, reportController.updateReportStatus);

// Archive report
router.patch('/:id/archive', isAuthenticated, reportController.archiveReport);

// Delete report (admin only)
router.delete('/:id', isAuthenticated, isAdmin, reportController.deleteReport);

// guest report creation
router.post('/guest', fileUpload.multiple, reportController.createGuestReport);

module.exports = router;