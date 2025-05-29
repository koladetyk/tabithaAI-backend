// src/controllers/authController.js
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const sgMail = require('@sendgrid/mail');
const db = require('../config/database');

// Initialize Google OAuth client
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Initialize SendGrid
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

class AuthController {
  constructor() {
    // Debug SendGrid environment variables
    console.log('SENDGRID_API_KEY present?', !!process.env.SENDGRID_API_KEY);
    console.log('FROM_EMAIL present?', !!process.env.FROM_EMAIL);
    if (process.env.SENDGRID_API_KEY) {
      console.log('SENDGRID_API_KEY starts with SG?', process.env.SENDGRID_API_KEY.startsWith('SG.'));
    }
  }

  // Helper method to send reset email - Fixed method binding
  async sendResetEmail(email, resetToken) {
    try {
      const msg = {
        to: email,
        from: process.env.FROM_EMAIL,
        subject: 'Tabitha AI - Password Reset Code',
        text: `Your password reset code is: ${resetToken}. This code will expire in 15 minutes.`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #333; margin-bottom: 10px;">Tabitha AI</h1>
              <h2 style="color: #666; font-weight: normal;">Password Reset Request</h2>
            </div>
            
            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
              <p style="margin: 0 0 15px 0; color: #333;">You requested a password reset for your account.</p>
              <p style="margin: 0 0 15px 0; color: #333;">Your reset code is:</p>
              <div style="text-align: center; margin: 20px 0;">
                <span style="font-size: 32px; font-weight: bold; color: #007bff; letter-spacing: 3px; background-color: white; padding: 15px 25px; border-radius: 6px; border: 2px solid #007bff;">
                  ${resetToken}
                </span>
              </div>
              <p style="margin: 0; color: #666; font-size: 14px;">This code will expire in 15 minutes.</p>
            </div>
            
            <div style="background-color: #fff3cd; padding: 15px; border-radius: 6px; border-left: 4px solid #ffc107;">
              <p style="margin: 0; color: #856404; font-size: 14px;">
                <strong>Security Note:</strong> If you didn't request this password reset, please ignore this email. Your password will remain unchanged.
              </p>
            </div>
            
            <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
              <p style="margin: 0; color: #999; font-size: 12px;">
                This email was sent by Tabitha AI Password Reset System
              </p>
            </div>
          </div>
        `
      };
      
      await sgMail.send(msg);
      console.log(`Password reset email sent to: ${email}`);
      return true;
    } catch (error) {
      console.error('Error sending reset email:', error);
      throw error;
    }
  }

  // Register new user with email OR phone number
  async register(req, res) {
    try {
      console.log('Register request received:', {
        body: req.body,
        headers: {
          origin: req.headers.origin,
          'content-type': req.headers['content-type']
        }
      });
      
      const { username, email, phone_number, password, full_name } = req.body;
      
      // Validate that either email or phone is provided
      if (!email && !phone_number) {
        return res.status(400).json({
          success: false,
          message: 'Either email or phone number is required'
        });
      }
      
      if (!password || !full_name) {
        return res.status(400).json({
          success: false,
          message: 'Password and full name are required'
        });
      }
      
      // Check if user already exists with email or phone
      let existingUserQuery = 'SELECT * FROM users WHERE ';
      const queryParams = [];
      
      if (email && phone_number) {
        existingUserQuery += 'email = $1 OR phone_number = $2';
        queryParams.push(email, phone_number);
      } else if (email) {
        existingUserQuery += 'email = $1';
        queryParams.push(email);
      } else {
        existingUserQuery += 'phone_number = $1';
        queryParams.push(phone_number);
      }
      
      if (username) {
        existingUserQuery += ` OR username = $${queryParams.length + 1}`;
        queryParams.push(username);
      }
      
      const existingUser = await db.query(existingUserQuery, queryParams);
      
      if (existingUser.rows.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'User already exists with this email, phone number, or username'
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
          phone_number,
          password_hash,
          full_name,
          created_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING *`,
        [userId, username, email, phone_number, hashedPassword, full_name]
      );
      
      // Generate JWT token
      const token = jwt.sign(
        { id: newUser.rows[0].id },
        process.env.JWT_SECRET,
        { expiresIn: '1d' }
      );
      
      // Set the token as a cookie
      res.cookie('auth_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        maxAge: 24 * 60 * 60 * 1000, // 1 day
        path: '/'
      });
      
      console.log('Register successful - cookie set');
      
      return res.status(201).json({
        success: true,
        user: {
          id: newUser.rows[0].id,
          username: newUser.rows[0].username,
          email: newUser.rows[0].email,
          phone_number: newUser.rows[0].phone_number,
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
  
  // Login user with email OR phone number
  async login(req, res) {
    try {
      console.log('Login request received:', {
        body: req.body,
        headers: {
          origin: req.headers.origin,
          'content-type': req.headers['content-type']
        }
      });
      
      const { email, phone_number, password } = req.body;
      
      // Validate that either email or phone is provided
      if (!email && !phone_number) {
        return res.status(400).json({
          success: false,
          message: 'Either email or phone number is required'
        });
      }
      
      if (!password) {
        return res.status(400).json({
          success: false,
          message: 'Password is required'
        });
      }
      
      // Check if user exists
      let userQuery = 'SELECT * FROM users WHERE ';
      let queryParam;
      
      if (email) {
        userQuery += 'email = $1';
        queryParam = email;
      } else {
        userQuery += 'phone_number = $1';
        queryParam = phone_number;
      }
      
      const user = await db.query(userQuery, [queryParam]);
      
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
      
      // Set the token as a cookie
      res.cookie('auth_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        maxAge: 24 * 60 * 60 * 1000, // 1 day
        path: '/'
      });
      
      console.log('Login successful - cookie set');
      
      return res.status(200).json({
        success: true,
        user: {
          id: user.rows[0].id,
          username: user.rows[0].username,
          email: user.rows[0].email,
          phone_number: user.rows[0].phone_number,
          full_name: user.rows[0].full_name,
          is_admin: user.rows[0].is_admin,
          profile_picture: user.rows[0].profile_picture
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

  // Enhanced Google OAuth callback handler
  async handleGoogleCallback(req, res) {
    try {
      console.log('Google OAuth callback received:', req.body);
      
      const { token } = req.body;
      
      if (!token) {
        return res.status(400).json({
          success: false,
          message: 'Google token is required'
        });
      }
      
      // Verify the Google token
      let ticket;
      let payload;
      
      try {
        ticket = await googleClient.verifyIdToken({
          idToken: token,
          audience: process.env.GOOGLE_CLIENT_ID
        });
        payload = ticket.getPayload();
      } catch (verifyError) {
        console.error('Google token verification failed:', verifyError);
        return res.status(401).json({
          success: false,
          message: 'Invalid Google token'
        });
      }
      
      const { sub: googleId, email, name, picture, email_verified } = payload;
      
      // Ensure email is verified
      if (!email_verified) {
        return res.status(400).json({
          success: false,
          message: 'Google email is not verified'
        });
      }
      
      console.log('Google user info:', { googleId, email, name, picture });
      
      // Check if user exists by Google ID first
      let user = await db.query('SELECT * FROM users WHERE google_id = $1', [googleId]);
      
      if (user.rows.length === 0) {
        // Check if user exists by email
        user = await db.query('SELECT * FROM users WHERE email = $1', [email]);
        
        if (user.rows.length === 0) {
          // Create new user
          const userId = uuidv4();
          const newUser = await db.query(
            `INSERT INTO users (
              id, 
              email, 
              full_name, 
              google_id, 
              profile_picture, 
              created_at, 
              updated_at
            ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING *`,
            [userId, email, name, googleId, picture]
          );
          user = newUser;
          console.log('Created new Google user:', userId);
        } else {
          // Update existing user with Google info
          user = await db.query(
            `UPDATE users SET 
              google_id = $1, 
              profile_picture = COALESCE(profile_picture, $2),
              full_name = COALESCE(full_name, $3),
              updated_at = CURRENT_TIMESTAMP 
            WHERE email = $4 RETURNING *`,
            [googleId, picture, name, email]
          );
          console.log('Updated existing user with Google info:', user.rows[0].id);
        }
      } else {
        // Update last login for existing Google user
        await db.query(
          'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
          [user.rows[0].id]
        );
        console.log('Google user login:', user.rows[0].id);
      }
      
      // Generate JWT token
      const jwtToken = jwt.sign(
        { id: user.rows[0].id },
        process.env.JWT_SECRET,
        { expiresIn: '1d' }
      );
      
      // Set the token as a cookie
      res.cookie('auth_token', jwtToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        maxAge: 24 * 60 * 60 * 1000, // 1 day
        path: '/'
      });
      
      console.log('Google OAuth successful - cookie set');
      
      return res.status(200).json({
        success: true,
        message: 'Google authentication successful',
        user: {
          id: user.rows[0].id,
          email: user.rows[0].email,
          full_name: user.rows[0].full_name,
          profile_picture: user.rows[0].profile_picture,
          username: user.rows[0].username,
          phone_number: user.rows[0].phone_number,
          is_admin: user.rows[0].is_admin
        }
      });
    } catch (error) {
      console.error('Error handling Google callback:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error handling Google authentication',
        error: error.message
      });
    }
  }

  // Get all reports for current user
  async getUserReports(req, res) {
    try {
      const userId = req.user.id;
      
      // Get all reports for the user with evidence
      const reports = await db.query(
        `SELECT r.*, 
          COALESCE(json_agg(e.*) FILTER (WHERE e.id IS NOT NULL), '[]') as evidence
        FROM reports r
        LEFT JOIN evidence e ON r.id = e.report_id
        WHERE r.user_id = $1
        GROUP BY r.id
        ORDER BY r.created_at DESC`,
        [userId]
      );
      
      return res.status(200).json({
        success: true,
        count: reports.rows.length,
        data: reports.rows
      });
    } catch (error) {
      console.error('Error fetching user reports:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error fetching reports',
        error: error.message
      });
    }
  }

  // Get reports by email or phone number (for user lookup)
  async getReportsByContact(req, res) {
    try {
      const { email, phone_number } = req.body;
      
      if (!email && !phone_number) {
        return res.status(400).json({
          success: false,
          message: 'Either email or phone number is required'
        });
      }
      
      // Find user by email or phone
      let userQuery = 'SELECT id FROM users WHERE ';
      let queryParam;
      
      if (email) {
        userQuery += 'email = $1';
        queryParam = email;
      } else {
        userQuery += 'phone_number = $1';
        queryParam = phone_number;
      }
      
      const user = await db.query(userQuery, [queryParam]);
      
      if (user.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'No user found with this email or phone number'
        });
      }
      
      // Get all reports for the user
      const reports = await db.query(
        `SELECT r.*, 
          COALESCE(json_agg(e.*) FILTER (WHERE e.id IS NOT NULL), '[]') as evidence
        FROM reports r
        LEFT JOIN evidence e ON r.id = e.report_id
        WHERE r.user_id = $1
        GROUP BY r.id
        ORDER BY r.created_at DESC`,
        [user.rows[0].id]
      );
      
      return res.status(200).json({
        success: true,
        count: reports.rows.length,
        data: reports.rows
      });
    } catch (error) {
      console.error('Error fetching reports by contact:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error fetching reports',
        error: error.message
      });
    }
  }

  // Update user profile
  async updateProfile(req, res) {
    try {
      const userId = req.user.id;
      const { username, email, phone_number, full_name } = req.body;
      
      // Check if email or phone already exists for another user
      if (email || phone_number) {
        let checkQuery = 'SELECT * FROM users WHERE id != $1 AND (';
        const checkParams = [userId];
        const conditions = [];
        
        if (email) {
          conditions.push(`email = $${checkParams.length + 1}`);
          checkParams.push(email);
        }
        
        if (phone_number) {
          conditions.push(`phone_number = $${checkParams.length + 1}`);
          checkParams.push(phone_number);
        }
        
        checkQuery += conditions.join(' OR ') + ')';
        
        const existingUser = await db.query(checkQuery, checkParams);
        
        if (existingUser.rows.length > 0) {
          return res.status(400).json({
            success: false,
            message: 'Email or phone number already exists for another user'
          });
        }
      }
      
      // Update user profile
      const updatedUser = await db.query(
        `UPDATE users SET
          username = COALESCE($1, username),
          email = COALESCE($2, email),
          phone_number = COALESCE($3, phone_number),
          full_name = COALESCE($4, full_name),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $5
        RETURNING id, username, email, phone_number, full_name, is_admin, profile_picture`,
        [username, email, phone_number, full_name, userId]
      );
      
      return res.status(200).json({
        success: true,
        user: updatedUser.rows[0],
        message: 'Profile updated successfully'
      });
    } catch (error) {
      console.error('Error updating profile:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error updating profile',
        error: error.message
      });
    }
  }

  // ENHANCED: Request password reset with SendGrid email support
  async requestPasswordReset(req, res) {
    try {
       // Debug logging
    console.log('=== PASSWORD RESET DEBUG ===');
    console.log('this:', typeof this);
    console.log('this.sendResetEmail:', typeof this.sendResetEmail);
    console.log('SENDGRID_API_KEY present?', !!process.env.SENDGRID_API_KEY);
    console.log('FROM_EMAIL present?', !!process.env.FROM_EMAIL);
    console.log('================================');
    
    const { email, phone_number } = req.body;
      
      if (!email && !phone_number) {
        return res.status(400).json({
          success: false,
          message: 'Either email or phone number is required'
        });
      }
      
      // Find user by email or phone
      let userQuery = 'SELECT * FROM users WHERE ';
      let queryParam;
      let isEmailReset = false;
      
      if (email) {
        userQuery += 'email = $1';
        queryParam = email;
        isEmailReset = true;
      } else {
        userQuery += 'phone_number = $1';
        queryParam = phone_number;
        isEmailReset = false;
      }
      
      const user = await db.query(userQuery, [queryParam]);
      
      if (user.rows.length === 0) {
        // Don't reveal if user doesn't exist for security
        if (isEmailReset) {
          return res.status(200).json({
            success: true,
            message: 'If a user with this email exists, a reset code has been sent'
          });
        } else {
          return res.status(400).json({
            success: false,
            message: 'SMS password reset is not implemented yet. Please use email or contact support.',
            feature_status: 'not_implemented'
          });
        }
      }
      
      // Handle phone-only users (no email)
      if (!isEmailReset && !user.rows[0].email) {
        return res.status(400).json({
          success: false,
          message: 'SMS password reset is not implemented yet. Please add an email to your account or contact support.',
          feature_status: 'not_implemented',
          suggestion: 'Please add an email address to your profile to enable password reset'
        });
      }
      
      // Generate reset token
      const resetToken = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit code
      const resetTokenExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
      
      // Store reset token
      await db.query(
        'UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE id = $3',
        [resetToken, resetTokenExpires, user.rows[0].id]
      );
      
      if (isEmailReset) {
        // Send email using SendGrid - Fixed method call
        try {
          // Use the instance method correctly
          await this.sendResetEmail(user.rows[0].email, resetToken);
          console.log(`Password reset email sent to: ${user.rows[0].email}`);
          
          return res.status(200).json({
            success: true,
            message: 'Password reset code has been sent to your email',
            delivery_method: 'email'
          });
        } catch (emailError) {
          console.error('Failed to send reset email:', emailError);
          
          // Clear the reset token if email fails
          await db.query(
            'UPDATE users SET reset_token = NULL, reset_token_expires = NULL WHERE id = $1',
            [user.rows[0].id]
          );
          
          return res.status(500).json({
            success: false,
            message: 'Failed to send reset email. Please try again later.',
            error_type: 'email_delivery_failed'
          });
        }
      } else {
        // Phone number provided but SMS not implemented
        return res.status(400).json({
          success: false,
          message: 'SMS password reset is not implemented yet. Please use your email address instead.',
          feature_status: 'not_implemented',
          user_email: user.rows[0].email ? 'available' : 'not_set'
        });
      }
    } catch (error) {
      console.error('Error requesting password reset:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error requesting password reset',
        error: error.message
      });
    }
  }

  // Reset password using token
  async resetPassword(req, res) {
    try {
      const { email, phone_number, reset_token, new_password } = req.body;
      
      if (!email && !phone_number) {
        return res.status(400).json({
          success: false,
          message: 'Either email or phone number is required'
        });
      }
      
      if (!reset_token || !new_password) {
        return res.status(400).json({
          success: false,
          message: 'Reset token and new password are required'
        });
      }
      
      // Find user with valid reset token
      let userQuery = 'SELECT * FROM users WHERE reset_token = $1 AND reset_token_expires > NOW() AND ';
      const queryParams = [reset_token];
      
      if (email) {
        userQuery += 'email = $2';
        queryParams.push(email);
      } else {
        userQuery += 'phone_number = $2';
        queryParams.push(phone_number);
      }
      
      const user = await db.query(userQuery, queryParams);
      
      if (user.rows.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Invalid or expired reset token'
        });
      }
      
      // Hash new password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(new_password, salt);
      
      // Update password and clear reset token
      await db.query(
        `UPDATE users SET 
          password_hash = $1, 
          reset_token = NULL, 
          reset_token_expires = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $2`,
        [hashedPassword, user.rows[0].id]
      );
      
      console.log(`Password reset successful for user: ${user.rows[0].email || user.rows[0].phone_number}`);
      
      return res.status(200).json({
        success: true,
        message: 'Password reset successfully'
      });
    } catch (error) {
      console.error('Error resetting password:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error resetting password',
        error: error.message
      });
    }
  }

  // Add logout functionality
  async logout(req, res) {
    try {
      console.log('Logout request received');
      
      // Clear cookie with the same path settings that were used when setting it
      res.clearCookie('auth_token', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        path: '/'
      });
      
      console.log('Logout successful - cookie cleared');
      
      return res.status(200).json({
        success: true,
        message: 'Logged out successfully'
      });
    } catch (error) {
      console.error('Error logging out:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error logging out',
        error: error.message
      });
    }
  }
  
  // Get current user
  async getCurrentUser(req, res) {
    try {
      console.log('Get current user request received');
      
      const user = await db.query(
        'SELECT id, username, email, phone_number, full_name, is_admin, profile_picture, google_id FROM users WHERE id = $1',
        [req.user.id]
      );
      
      if (user.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }
      
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