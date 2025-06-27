// src/routes/evidenceRoutes.js
const express = require('express');
const multer = require('multer');
const router = express.Router();
const evidenceController = require('../controllers/evidenceController');
const { isAuthenticated, isAdmin } = require('../middleware/auth');
const auth = require('../middleware/auth');
const fileUpload = require('../middleware/fileUpload');

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    // Allow images, audio, video, and documents
    const allowedTypes = /jpeg|jpg|png|gif|bmp|webp|mp3|wav|ogg|m4a|aac|mp4|avi|mov|wmv|flv|pdf|doc|docx|txt/;
    const extname = allowedTypes.test(file.originalname.toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

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