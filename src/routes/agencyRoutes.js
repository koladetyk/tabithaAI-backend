const express = require('express');
const router = express.Router();
const agencyController = require('../controllers/agencyController');
const { isAuthenticated, isAdmin } = require('../middleware/auth');

router.post('/', isAuthenticated, isAdmin, agencyController.addAgency);
router.put('/:id', isAuthenticated, isAdmin, agencyController.updateAgency);
router.delete('/:id', isAuthenticated, isAdmin, agencyController.deleteAgency);
router.get('/', isAuthenticated, isAdmin, agencyController.getAgencies);
// Add a contact to an existing agency
router.post('/:id/contacts', isAuthenticated, isAdmin, agencyController.addContactPerson);

// Delete a specific contact from an agency
router.delete('/:agencyId/contacts/:userId', isAuthenticated, isAdmin, agencyController.deleteContactPerson);

router.get('/:id', isAuthenticated, isAdmin, agencyController.getAgencyById);

// FIX: remove `/agencies` prefix inside the path
router.patch('/:id/status', isAuthenticated, isAdmin, agencyController.toggleAgencyStatus);





module.exports = router;
