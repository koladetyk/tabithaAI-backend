const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../config/database');

class AuthController {
  // Register new user
  async register(req, res) {
    try {
      const { username, email, password, full_name, phone_number } = req.body;
      
      // Check if username or email already exists
      const existingUser = await db.query(
        'SELECT * FROM users WHERE username = $1 OR email = $2',
        [username, email]
      );
      
      if (existingUser.rows.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Username or email already exists'
        });
      }
      
      // Hash password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);
      
      // Create new user
      const userId = uuidv4();
      const newUser = await db.query(
        `INSERT INTO users (
          id,
          username,
          email,
          password_hash,
          full_name,
          phone_number,
          created_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING *`,
        [userId, username, email, hashedPassword, full_name, phone_number]
      );
      
      // Generate JWT token
      const token = jwt.sign(
        { id: newUser.rows[0].id },
        process.env.JWT_SECRET,
        { expiresIn: '1d' }
      );
      
      return res.status(201).json({
        success: true,
        token,
        user: {
          id: newUser.rows[0].id,
          username: newUser.rows[0].username,
          email: newUser.rows[0].email,
          full_name: newUser.rows[0].full_name
        }
      });
    } catch (error) {
      console.error('Error registering user:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error registering user',
        error: error.message
      });
    }
  }
  
  // Login user
  async login(req, res) {
    try {
      const { email, password } = req.body;
      
      // Check if user exists
      const user = await db.query(
        'SELECT * FROM users WHERE email = $1',
        [email]
      );
      
      if (user.rows.length === 0) {
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials'
        });
      }
      
      // Check password
      const isMatch = await bcrypt.compare(password, user.rows[0].password_hash);
      
      if (!isMatch) {
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials'
        });
      }
      
      // Update last login
      await db.query(
        'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
        [user.rows[0].id]
      );
      
      // Generate JWT token
      const token = jwt.sign(
        { id: user.rows[0].id },
        process.env.JWT_SECRET,
        { expiresIn: '1d' }
      );
      
      return res.status(200).json({
        success: true,
        token,
        user: {
          id: user.rows[0].id,
          username: user.rows[0].username,
          email: user.rows[0].email,
          full_name: user.rows[0].full_name,
          is_admin: user.rows[0].is_admin
        }
      });
    } catch (error) {
      console.error('Error logging in:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error logging in',
        error: error.message
      });
    }
  }
  
  // Get current user
  async getCurrentUser(req, res) {
    try {
      const user = await db.query(
        'SELECT id, username, email, full_name, is_admin FROM users WHERE id = $1',
        [req.user.id]
      );
      
      return res.status(200).json({
        success: true,
        user: user.rows[0]
      });
    } catch (error) {
      console.error('Error getting user:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error getting user',
        error: error.message
      });
    }
  }
}

module.exports = new AuthController();
