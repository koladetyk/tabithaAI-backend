// src/routes/authRoutes.js
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { isAuthenticated } = require('../middleware/auth');

// Register with email or phone
router.post('/register', authController.register);

// Login with email or phone
router.post('/login', authController.login);

// Google OAuth callback endpoint
router.post('/google/callback', authController.handleGoogleCallback);

// Get current user
router.get('/me', isAuthenticated, authController.getCurrentUser);

// Get all reports for current user
router.get('/reports', isAuthenticated, authController.getUserReports);

// Get reports by email/phone (for user lookup)
router.post('/reports/lookup', authController.getReportsByContact);

// Update user profile
router.patch('/profile', isAuthenticated, authController.updateProfile);

// Change password (sends token to email/phone first)
router.post('/password/reset-request', authController.requestPasswordReset);
router.post('/password/reset', authController.resetPassword);

// Logout
router.get('/logout', authController.logout);

module.exports = router;