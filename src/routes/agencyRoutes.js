const express = require('express');
const router = express.Router();
const agencyController = require('../controllers/agencyController');
const { isAuthenticated, isAdmin } = require('../middleware/auth');
const { isAgencyUser } = require('../middleware/roleChecks');

// SPECIFIC ROUTES FIRST (before any /:id routes)

// Get collective summary for all agencies - MOVED FIRST
router.get('/collective-summary', isAuthenticated, isAdmin, agencyController.getCollectiveAgencySummary);

// Get all agencies with contacts
router.get('/', isAuthenticated, isAdmin,  agencyController.getAgencies);

// PARAMETERIZED ROUTES AFTER SPECIFIC ROUTES

// Get a single agency by ID
router.get('/:id', isAuthenticated, isAdmin, agencyController.getAgencyById);

// Get summary info for a specific agency
router.get('/:id/report-summary', isAuthenticated, isAdmin, agencyController.getSingleAgencyReportSummary);

// Get reports referred to a specific agency
router.get('/:id/referred-reports', isAuthenticated, isAdmin, isAgencyUser, agencyController.getReferredReportsForAgency);

// POST ROUTES

// Create a new agency
router.post('/', isAuthenticated, isAdmin, agencyController.addAgency);

// Add a contact person to an agency
router.post('/:id/contacts', isAuthenticated, isAdmin, agencyController.addContactPerson);

// PUT/PATCH ROUTES

// Update agency details
router.put('/:id', isAuthenticated, isAdmin, agencyController.updateAgency);

// Update/Edit a specific contact person in an agency
router.put('/:agencyId/contacts/:userId', isAuthenticated, isAdmin, agencyController.updateContactPerson);

// Toggle status (Active/Inactive)
router.patch('/:id/status', isAuthenticated, isAdmin, agencyController.toggleAgencyStatus);

// DELETE ROUTES

// Delete an agency
router.delete('/:id', isAuthenticated, isAdmin, agencyController.deleteAgency);

// Delete a specific contact from an agency
router.delete('/:agencyId/contacts/:userId', isAuthenticated, isAdmin, agencyController.deleteContactPerson);

module.exports = router;