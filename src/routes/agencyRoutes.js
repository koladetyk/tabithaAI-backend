const express = require('express');
const router = express.Router();
const agencyController = require('../controllers/agencyController');
const { isAuthenticated, isAdmin } = require('../middleware/auth');

// Create a new agency
router.post('/', isAuthenticated, isAdmin, agencyController.addAgency);

// Update agency details
router.put('/:id', isAuthenticated, isAdmin, agencyController.updateAgency);

// Delete an agency
router.delete('/:id', isAuthenticated, isAdmin, agencyController.deleteAgency);

// Get all agencies with contacts
router.get('/', isAuthenticated, isAdmin, agencyController.getAgencies);

// Get a single agency by ID
router.get('/:id', isAuthenticated, isAdmin, agencyController.getAgencyById);

// Toggle status (Active/Inactive)
router.patch('/:id/status', isAuthenticated, isAdmin, agencyController.toggleAgencyStatus);

// Add a contact person to an agency
router.post('/:id/contacts', isAuthenticated, isAdmin, agencyController.addContactPerson);

// Delete a specific contact from an agency
router.delete('/:agencyId/contacts/:userId', isAuthenticated, isAdmin, agencyController.deleteContactPerson);

// NEW: Get summary info for a specific agency
router.get('/:id/report-summary', isAuthenticated, isAdmin, agencyController.getSingleAgencyReportSummary);

// Add this route BEFORE any parameterized routes like /:id
router.get('/collective-summary', isAuthenticated, isAdmin, agencyController.getCollectiveAgencySummary);

// ✅ NEW: Get reports referred to a specific agency
router.get('/:id/referred-reports', isAuthenticated, isAdmin, agencyController.getReferredReportsForAgency);

module.exports = router;
