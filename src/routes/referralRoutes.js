// src/routes/referralRoutes.js
const express = require('express');
const router = express.Router();
const referralController = require('../controllers/referralController');
const { isAuthenticated, isAdmin } = require('../middleware/auth');

// Get all referrals for a report
router.get('/reports/:reportId/referrals', isAuthenticated, referralController.getReferralsForReport);

// Get referral by ID
router.get('/referrals/:id', isAuthenticated, referralController.getReferralById);

// Create new referral
router.post('/referrals', isAuthenticated, referralController.createReferral);

// Update referral status
router.patch('/referrals/:id/status', isAuthenticated, referralController.updateReferralStatus);

// Delete referral (admin only)
router.delete('/referrals/:id', isAuthenticated, isAdmin, referralController.deleteReferral);

module.exports = router;