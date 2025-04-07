// src/routes/evidenceRoutes.js
const express = require('express');
const router = express.Router();
const evidenceController = require('../controllers/evidenceController');
const { isAuthenticated, isAdmin } = require('../middleware/auth');
const fileUpload = require('../middleware/fileUpload');

// Add evidence to a report
router.post('/reports/:reportId/evidence', isAuthenticated, fileUpload.multiple, evidenceController.addEvidence);

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

/// Get signed URL for evidence
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