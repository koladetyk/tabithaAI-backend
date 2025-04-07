// src/routes/voiceReportRoutes.js
const express = require('express');
const router = express.Router();
const voiceReportController = require('../controllers/voiceReportController');
const { isAuthenticated } = require('../middleware/auth');
const fileUpload = require('../middleware/fileUpload');

// Submit a voice report
router.post(
  '/submit',
  isAuthenticated,
  fileUpload.single('audioFile'),
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