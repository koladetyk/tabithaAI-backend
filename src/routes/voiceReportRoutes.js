// src/routes/voiceReportRoutes.js
const express = require('express');
const router = express.Router();
const voiceReportController = require('../controllers/voiceReportController');
const { isAuthenticated } = require('../middleware/auth');
const fileUpload = require('../middleware/fileUpload');

// Submit a voice report - apply the middleware directly in the route handler
router.post(
  '/submit',
  isAuthenticated,
  (req, res, next) => {
    // Apply the fileUpload.single middleware at request time, not load time
    fileUpload.single('audioFile')(req, res, (err) => {
      if (err) {
        return res.status(400).json({
          success: false,
          message: 'File upload error',
          error: err.message
        });
      }
      next();
    });
  },
  voiceReportController.submitVoiceReport
);

// Get voice file for a report
router.get(
  '/:id/audio',
  isAuthenticated,
  voiceReportController.getVoiceFile
);

// Reanalyze a voice report
router.post(
  '/:id/reanalyze',
  isAuthenticated,
  voiceReportController.reanalyzeVoiceReport
);

module.exports = router;