// src/routes/reportRoutes.js
const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const { isAuthenticated, isAdmin } = require('../middleware/auth');
const fileUpload = require('../middleware/fileUpload');

// Get all reports (admin only)
router.get('/', isAuthenticated, isAdmin, reportController.getAllReports);

// Get reports by email for guest users (no authentication required)
router.get('/guest/email/:email', reportController.getGuestReportsByEmail);

// ENHANCED: Get reports by contact info (email/phone lookup)
router.post('/lookup', reportController.getReportsByContact);

// Get reports by user ID
router.get('/user/:userId', isAuthenticated, reportController.getReportsByUserId);

// Reanalyze a report with enhanced AI
router.post('/:id/reanalyze', isAuthenticated, reportController.reanalyzeReport);

// Get individual report by ID
router.get('/:id', isAuthenticated, reportController.getReportById);

// ENHANCED: Create new report with array structure support
// Supports: audio_files[], images_videos[], note, email, phoneNumber, address
// File uploads are additional to the arrays (URIs can be provided in arrays)
router.post('/', isAuthenticated, fileUpload.multiple, reportController.createReport);

// LEGACY: Create new audio-specific report (backwards compatibility)
// This now redirects to the main createReport with transformed data
router.post('/audio', isAuthenticated, fileUpload.multiple, reportController.createAudioReport);

// Update report
router.put('/:id', isAuthenticated, reportController.updateReport);

// Update report status
router.patch('/:id/status', isAuthenticated, reportController.updateReportStatus);

// Archive report
router.patch('/:id/archive', isAuthenticated, reportController.archiveReport);

// Delete report (admin only)
router.delete('/:id', isAuthenticated, isAdmin, reportController.deleteReport);

// ENHANCED: Guest report creation with array structure support
// No authentication required - perfect for anonymous reporting
router.post('/guest', fileUpload.multiple, reportController.createGuestReport);

module.exports = router;