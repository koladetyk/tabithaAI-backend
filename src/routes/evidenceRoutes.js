// src/routes/evidenceRoutes.js
const express = require('express');
const router = express.Router();
const evidenceController = require('../controllers/evidenceController');
const { isAuthenticated, isAdmin } = require('../middleware/auth');

// UPDATED: Import the new optimized file upload middleware
const fileUpload = require('../middleware/optimizedFileUpload');

// REMOVED: The duplicate multer configuration (now handled by optimizedFileUpload)

// Add evidence to a report
// UPDATED: Using new middleware with smart file size limits and better error handling
router.post('/reports/:reportId/evidence', 
  isAuthenticated, 
  ...fileUpload.multiple('files', 10), // Allow up to 10 evidence files
  evidenceController.addEvidence
);

// Alternative route for single evidence upload (useful for specific file types)
router.post('/reports/:reportId/evidence/image',
  isAuthenticated,
  fileUpload.imageUpload.single('file'),
  fileUpload.handleUploadError,
  evidenceController.addEvidence
);

router.post('/reports/:reportId/evidence/audio',
  isAuthenticated,
  fileUpload.audioUpload.single('audioFile'),
  fileUpload.handleUploadError,
  evidenceController.addEvidence
);

router.post('/reports/:reportId/evidence/video',
  isAuthenticated,
  fileUpload.videoUpload.single('file'),
  fileUpload.handleUploadError,
  evidenceController.addEvidence
);

router.post('/reports/:reportId/evidence/document',
  isAuthenticated,
  fileUpload.documentUpload.single('file'),
  fileUpload.handleUploadError,
  evidenceController.addEvidence
);

// Get all evidence for a report
router.get('/reports/:reportId/evidence',
  isAuthenticated,
  evidenceController.getEvidenceForReport
);

// Get single evidence by ID
router.get('/evidence/:id',
  isAuthenticated,
  evidenceController.getEvidenceById
);

// Update evidence description
router.patch('/evidence/:id',
  isAuthenticated,
  evidenceController.updateEvidenceDescription
);

// Get signed URL for evidence
router.get('/evidence/:id/url',
  isAuthenticated,
  evidenceController.getEvidenceSignedUrl
);

// Delete evidence
router.delete('/evidence/:id',
  isAuthenticated,
  evidenceController.deleteEvidence
);

module.exports = router;