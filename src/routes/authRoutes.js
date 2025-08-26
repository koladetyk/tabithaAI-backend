// src/routes/authRoutes.js
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { isAuthenticated, isAdmin } = require('../middleware/auth');

// Register with email or phone
router.post('/register', authController.register);

// Route: Delete user — only admin can delete regular users, only master admin can delete admins
router.delete('/delete/:id', isAuthenticated, isAdmin, authController.deleteUser); // Changed from :email to :id

// Login with email or phone
router.post('/login', authController.login);

// Login with admin
router.post('/admin/login', authController.adminLogin);

// Google OAuth callback endpoint
router.post('/google/callback', authController.handleGoogleCallback);

// Also allow simple /google endpoint for direct token verification  
router.post('/google', authController.handleGoogleCallback);

// Get current user
router.get('/me', isAuthenticated, authController.getCurrentUser);

// Get all reports for current user
router.get('/reports', isAuthenticated, authController.getUserReports);

// Get reports by email/phone (for user lookup)
router.post('/reports/lookup', authController.getReportsByContact);

// Update user profile
router.patch('/profile', isAuthenticated, authController.updateProfile);

// Change password (sends token to email/phone first)
router.post('/password/reset-request', authController.requestPasswordReset.bind(authController));
router.post('/password/reset', authController.resetPassword);

// Logout
router.get('/logout', authController.logout);

module.exports = router;