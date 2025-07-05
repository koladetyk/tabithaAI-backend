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



module.exports = router;
