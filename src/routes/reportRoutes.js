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

// CHANGE THIS SECTION:

// ENHANCED: Create new report with array structure support
router.post('/',
  isAuthenticated,
  fileUpload.smartUpload.any(), // Use smartUpload.any()
  (req, res, next) => {
    // Normalize files to array format
    if (req.files && !Array.isArray(req.files)) {
      const filesArray = [];
      Object.keys(req.files).forEach(fieldName => {
        if (Array.isArray(req.files[fieldName])) {
          filesArray.push(...req.files[fieldName]);
        } else {
          filesArray.push(req.files[fieldName]);
        }
      });
      req.files = filesArray;
    }
    next();
  },
  fileUpload.handleUploadError,
  reportController.createReport
);

// LEGACY: Create new audio-specific report
router.post('/audio',
  isAuthenticated,
  fileUpload.smartUpload.any(),
  (req, res, next) => {
    // Same normalization
    if (req.files && !Array.isArray(req.files)) {
      const filesArray = [];
      Object.keys(req.files).forEach(fieldName => {
        if (Array.isArray(req.files[fieldName])) {
          filesArray.push(...req.files[fieldName]);
        } else {
          filesArray.push(req.files[fieldName]);
        }
      });
      req.files = filesArray;
    }
    next();
  },
  fileUpload.handleUploadError,
  reportController.createAudioReport
);

// ENHANCED: Guest report creation
router.post('/guest',
  fileUpload.smartUpload.any(), // Use smartUpload.any()
  (req, res, next) => {
    console.log('Middleware - Raw req.files:', req.files);
    
    // Normalize files to array format
    if (req.files && !Array.isArray(req.files)) {
      const filesArray = [];
      Object.keys(req.files).forEach(fieldName => {
        console.log(`Processing field: ${fieldName}`);
        if (Array.isArray(req.files[fieldName])) {
          filesArray.push(...req.files[fieldName]);
        } else {
          filesArray.push(req.files[fieldName]);
        }
      });
      req.files = filesArray;
    }
    
    console.log('Middleware - Normalized req.files:', req.files);
    next();
  },
  fileUpload.handleUploadError,
  reportController.createGuestReport
);

// Update report
router.put('/:id', isAuthenticated, reportController.updateReport);

// Update report status
router.patch('/:id/status', isAuthenticated, reportController.updateReportStatus);

// Archive report
router.patch('/:id/archive', isAuthenticated, reportController.archiveReport);

// Delete report (admin only)
router.delete('/:id', isAuthenticated, isAdmin, reportController.deleteReport);


module.exports = router;