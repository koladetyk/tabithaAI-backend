const express = require('express');
const router = express.Router();
const agencyController = require('../controllers/agencyController');
const { isAuthenticated, isAdmin } = require('../middleware/auth');

router.post('/', isAuthenticated, isAdmin, agencyController.addAgency);
router.put('/:id', isAuthenticated, isAdmin, agencyController.updateAgency);
router.delete('/:id', isAuthenticated, isAdmin, agencyController.deleteAgency);
router.get('/', isAuthenticated, isAdmin, agencyController.getAgencies);


module.exports = router;
