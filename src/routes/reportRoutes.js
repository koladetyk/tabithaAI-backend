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

// Get reports by user ID
router.get('/user/:userId', isAuthenticated, reportController.getReportsByUserId);

// Reanalyze a report with enhanced AI
router.post('/:id/reanalyze', isAuthenticated, reportController.reanalyzeReport);

// Get individual report by ID
router.get('/:id', isAuthenticated, reportController.getReportById);

// Create new report with file upload support (including audio files)
// This supports both audio files and other file types (images, videos, documents)
router.post('/', isAuthenticated, fileUpload.multiple, reportController.createReport);

// Create new audio-specific report (supports audio files with transcription and other data)
router.post('/audio', isAuthenticated, fileUpload.multiple, reportController.createAudioReport);

// Update report
router.put('/:id', isAuthenticated, reportController.updateReport);

// Update report status
router.patch('/:id/status', isAuthenticated, reportController.updateReportStatus);

// Archive report
router.patch('/:id/archive', isAuthenticated, reportController.archiveReport);

// Delete report (admin only)
router.delete('/:id', isAuthenticated, isAdmin, reportController.deleteReport);

// Guest report creation (supports all file types including audio)
router.post('/guest', fileUpload.multiple, reportController.createGuestReport);

module.exports = router;