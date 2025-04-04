// src/routes/voiceReportRoutes.js
const express = require('express');
const router = express.Router();
const voiceReportController = require('../controllers/voiceReportController');
const { isAuthenticated } = require('../middleware/auth');
const { upload } = require('../middleware/fileUpload');

// Configure upload specifically for audio files
const audioUpload = upload.single('audioFile');

// Submit a voice report
router.post(
  '/submit',
  isAuthenticated,
  audioUpload,
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