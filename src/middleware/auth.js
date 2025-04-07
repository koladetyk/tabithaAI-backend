const jwt = require('jsonwebtoken');
const db = require('../config/database');

// In auth.js middleware
const isAuthenticated = async (req, res, next) => {
  try {
    // Get token from cookie instead of Authorization header
    const token = req.cookies.auth_token;
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No valid authentication token, access denied'
      });
    }
    
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      console.log('Token verified. Decoded ID:', decoded.id);
      
      const user = await db.query(
        'SELECT * FROM users WHERE id = $1', 
        [decoded.id]
      );
      
      if (user.rows.length === 0) {
        return res.status(401).json({
          success: false,
          message: 'User not found'
        });
      }
      
      console.log('User found:', user.rows[0].username);
      req.user = user.rows[0];
      next();
    } catch (jwtError) {
      console.error('JWT verification error:', jwtError);
      return res.status(401).json({
        success: false,
        message: 'Invalid token',
        error: jwtError.message
      });
    }
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error in authentication',
      error: error.message
    });
  }
};

const isAdmin = (req, res, next) => {
  if (!req.user.is_admin) {
    return res.status(403).json({
      success: false,
      message: 'Admin privileges required'
    });
  }
  next();
};

module.exports = { isAuthenticated, isAdmin };