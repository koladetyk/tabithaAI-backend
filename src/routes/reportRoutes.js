// src/routes/reportRoutes.js
const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const { isAuthenticated, isAdmin } = require('../middleware/auth');
const { isAgencyUser } = require('../middleware/roleChecks');

// UPDATED: Import the new optimized file upload middleware
const fileUpload = require('../middleware/optimizedFileUpload');

// Get all reports (admin only)
router.get('/', isAuthenticated, isAdmin, reportController.getAllReports);

// Get reports by verification token only (no email needed)
router.get('/guest/token/:token', reportController.getGuestReportsByToken);

// Get reports by email for guest users (no authentication required)
router.get('/guest/email/:email', reportController.getGuestReportsByEmail);

// Public access to individual report via public ID or token
router.get('/public/:id', reportController.getPublicReportById);

// ENHANCED: Get reports by contact info (email/phone lookup)
router.get('/lookup', reportController.getReportsByContact);

// Get reports by user ID
router.get('/user/:userId', isAuthenticated, reportController.getReportsByUserId);

// Get Dashboard stats
router.get('/admin/stats', isAuthenticated, isAdmin, reportController.getDashboardStats);

// NEW: Get latest 100 reports - MOVED BEFORE /:id route
router.get('/latest-reports', isAuthenticated, isAdmin, reportController.getLatestReports);

// NEW: Get latest 100 reports referred to agencies (admin and agency users)
router.get('/latest-referred', isAuthenticated, (req, res, next) => {
  // Allow both admin and agency users
  if (req.user.is_admin || req.user.is_agency_user) {
    return next();
  }
  return res.status(403).json({
    success: false,
    message: 'Admin or agency user access required'
  });
}, reportController.getLatestReferredReports);

// Reanalyze a report with enhanced AI
router.post('/:id/reanalyze', isAuthenticated, reportController.reanalyzeReport);

// Get individual report by ID - MOVED AFTER specific routes
router.get('/:id', isAuthenticated, reportController.getReportById);

// ENHANCED: Create new report with array structure support
// Supports: audio_files[], images_videos[], note, email, phoneNumber, address
// File uploads are additional to the arrays (URIs can be provided in arrays)
// UPDATED: Using new middleware with better error handling and file size limits
router.post('/', 
  isAuthenticated, 
  ...fileUpload.multiple('files', 10), // Allow up to 10 files with smart size limits
  reportController.createReport
);

// LEGACY: Create new audio-specific report (backwards compatibility)
// This now redirects to the main createReport with transformed data
// UPDATED: Using audio-specific middleware for better audio file handling
router.post('/audio', 
  isAuthenticated, 
  fileUpload.audioUpload.array('files', 5), // Up to 5 audio files
  fileUpload.handleUploadError,
  reportController.createAudioReport
);

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
// UPDATED: Using new middleware with proper file size limits
router.post('/guest', 
  ...fileUpload.multiple('files', 10), // Allow up to 10 files for guest reports
  reportController.createGuestReport
);

module.exports = router;