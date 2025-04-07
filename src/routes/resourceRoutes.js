// src/routes/resourceRoutes.js
const express = require('express');
const router = express.Router();
const resourceController = require('../controllers/resourceController');
const { isAuthenticated, isAdmin } = require('../middleware/auth');
const fileUpload = require('../middleware/fileUpload');

// Get all resources (with filtering)
router.get('/resources', resourceController.getAllResources);

// Get resource by ID
router.get('/resources/:id', resourceController.getResourceById);

// Get resource file
router.get('/resources/:id/file', resourceController.getResourceFile);

// Create new resource (admin only)
router.post(
  '/resources',
  isAuthenticated,
  isAdmin,
  (req, res, next) => {
    fileUpload.single('file')(req, res, (err) => {
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
  resourceController.createResource
);

// Update resource (admin only)
router.put(
  '/resources/:id',
  isAuthenticated,
  isAdmin,
  (req, res, next) => {
    fileUpload.single('file')(req, res, (err) => {
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
  resourceController.updateResource
);

// Delete resource (admin only)
router.delete('/resources/:id', isAuthenticated, isAdmin, resourceController.deleteResource);

module.exports = router;