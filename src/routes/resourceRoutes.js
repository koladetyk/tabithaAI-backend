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
  fileUpload.single('file'),
  resourceController.createResource
);

// Update resource (admin only)
router.put(
  '/resources/:id',
  isAuthenticated,
  isAdmin,
  fileUpload.single('file'),
  resourceController.updateResource
);

// Delete resource (admin only)
router.delete('/resources/:id', isAuthenticated, isAdmin, resourceController.deleteResource);

module.exports = router;