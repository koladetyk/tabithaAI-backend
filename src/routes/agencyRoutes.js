const express = require('express');
const router = express.Router();
const agencyController = require('../controllers/agencyController');
const { isAuthenticated, isAdmin } = require('../middleware/auth');
const { isAgencyUser } = require('../middleware/roleChecks');

// Custom middleware to allow both admin and agency users
const isAdminOrAgencyUser = (req, res, next) => {
  if (req.user && (req.user.is_admin || req.user.is_agency_user)) {
    return next();
  }
  return res.status(403).json({ 
    success: false, 
    message: 'Admin or agency user access required' 
  });
};

// SPECIFIC ROUTES FIRST (before any /:id routes)

// Get collective summary for all agencies - ADMIN ONLY
router.get('/collective-summary', isAuthenticated, isAdmin, agencyController.getCollectiveAgencySummary);

// Get all agencies with contacts - ADMIN ONLY
router.get('/', isAuthenticated, isAdmin, agencyController.getAgencies);

// PARAMETERIZED ROUTES AFTER SPECIFIC ROUTES

// Get a single agency by ID - ADMIN ONLY
router.get('/:id', isAuthenticated, isAdmin, agencyController.getAgencyById);

// Get summary info for a specific agency - ADMIN ONLY
router.get('/:id/report-summary', isAuthenticated, isAdmin, agencyController.getSingleAgencyReportSummary);

// FIXED: Get reports referred to a specific agency - ADMIN OR AGENCY USER
router.get('/:id/referred-reports', isAuthenticated, isAdminOrAgencyUser, agencyController.getReferredReportsForAgency);

// POST ROUTES - ADMIN ONLY

// Create a new agency
router.post('/', isAuthenticated, isAdmin, agencyController.addAgency);

// Add a contact person to an agency
router.post('/:id/contacts', isAuthenticated, isAdmin, agencyController.addContactPerson);

// PUT/PATCH ROUTES - ADMIN ONLY

// Update agency details
router.put('/:id', isAuthenticated, isAdmin, agencyController.updateAgency);

// Update/Edit a specific contact person in an agency
router.put('/:agencyId/contacts/:userId', isAuthenticated, isAdmin, agencyController.updateContactPerson);

// Toggle status (Active/Inactive)
router.patch('/:id/status', isAuthenticated, isAdmin, agencyController.toggleAgencyStatus);

// DELETE ROUTES - ADMIN ONLY

// Delete an agency
router.delete('/:id', isAuthenticated, isAdmin, agencyController.deleteAgency);

// Delete a specific contact from an agency
router.delete('/:agencyId/contacts/:userId', isAuthenticated, isAdmin, agencyController.deleteContactPerson);

module.exports = router;