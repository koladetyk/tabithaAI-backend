const express = require('express');
const passport = require('passport');
const jwt = require('jsonwebtoken');
const router = express.Router();

// Initiate Google authentication
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

// Google authentication callback
router.get('/google/callback', 
  passport.authenticate('google', { session: false, failureRedirect: '/api/v1/auth/google/failure' }),
  (req, res) => {
    // Generate JWT token
    const token = jwt.sign(
      { id: req.user.id },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );
    
    // Redirect to frontend with token
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth-callback?token=${token}`);
  }
);

// Google authentication failure
router.get('/google/failure', (req, res) => {
  res.status(401).json({
    success: false,
    message: 'Google authentication failed'
  });
});

module.exports = router;