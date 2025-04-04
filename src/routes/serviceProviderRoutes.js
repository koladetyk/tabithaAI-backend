// src/routes/serviceProviderRoutes.js
const express = require('express');
const router = express.Router();
const serviceProviderController = require('../controllers/serviceProviderController');
const { isAuthenticated, isAdmin } = require('../middleware/auth');

// Get all service providers
router.get('/', serviceProviderController.getAllProviders);

// Search providers by criteria
router.get('/search', serviceProviderController.searchProviders);

// Search for nearby providers
router.get('/nearby', serviceProviderController.searchNearbyProviders);

// Get service provider by ID
router.get('/:id', serviceProviderController.getProviderById);

// Create new service provider (admin only)
router.post('/', isAuthenticated, isAdmin, serviceProviderController.createProvider);

// Update service provider (admin only)
router.put('/:id', isAuthenticated, isAdmin, serviceProviderController.updateProvider);

// Delete service provider (admin only)
router.delete('/:id', isAuthenticated, isAdmin, serviceProviderController.deleteProvider);

module.exports = router;