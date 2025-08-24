// src/controllers/authController.js
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const db = require('../config/database');

// Add this import instead:
const { sendResetEmail } = require('../utils/sendTempPasswordEmail');

// Initialize Google OAuth client
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);


class AuthController {
  constructor() {
    // Debug Resend environment variables
    
  }

  async sendResetEmail(email, resetToken) {
    try {
      const { sendResetEmail } = require('../utils/sendTempPasswordEmail');
      await sendResetEmail(email, resetToken);
      console.log(`Password reset email sent to: ${email}`);
      return { success: true };
    } catch (error) {
      console.error('Error sending reset email:', error);
      throw error;
    }
  }

  // ENHANCED: Request password reset with Resend email support
  async requestPasswordReset(req, res) {
    try {
      
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
        // Send email using Resend
        try {
          await this.sendResetEmail(user.rows[0].email, resetToken);
          console.log(`Password reset email sent successfully to: ${user.rows[0].email}`);
          
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
            error_type: 'email_delivery_failed',
            error_details: process.env.NODE_ENV !== 'production' ? emailError.message : undefined
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

// Register new user with email OR phone number (address optional)
// ENHANCED: Smart handling of anonymous reports vs existing users
async register(req, res) {
  const client = await db.connect();
  
  try {
    await client.query('BEGIN');
    
    console.log('Register request received:', {
      body: req.body,
      headers: {
        origin: req.headers.origin,
        'content-type': req.headers['content-type']
      }
    });
    
    const { username, email, phone_number, password, full_name, address } = req.body;
    
    // Validate that either email or phone is provided
    if (!email && !phone_number) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Either email or phone number is required'
      });
    }
    
    if (!password || !full_name) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Password and full name are required'
      });
    }
    
    // UPDATED LOGIC: Only check for existing USERS, not anonymous reports
    // Check if user already exists with email or phone IN THE USERS TABLE
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
    
    const existingUser = await client.query(existingUserQuery, queryParams);

    // Block registration ONLY if user already exists in users table
    if (existingUser.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'User already exists with this email, phone number, or username'
      });
    }
    
    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    // Create new user (including address field, even if null)
    const userId = uuidv4();
    const newUser = await client.query(
      `INSERT INTO users (
        id,
        username,
        email,
        phone_number,
        password_hash,
        full_name,
        address,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) 
      RETURNING id, username, email, phone_number, full_name, address, is_admin, profile_picture`,
      [userId, username, email, phone_number, hashedPassword, full_name, address || null]
    );
    
    // Find anonymous reports that match this user's email or phone number
    let reportLinkQuery = `
      SELECT r.id, r.title, r.contact_info, r.created_at 
      FROM reports r 
      WHERE r.anonymous = true 
      AND r.user_id IS NULL 
      AND (`;
    
    const reportQueryParams = [];
    const conditions = [];
    
    if (email) {
      conditions.push(`r.contact_info->>'email' = $${reportQueryParams.length + 1}`);
      reportQueryParams.push(email);
    }
    
    if (phone_number) {
      conditions.push(`r.contact_info->>'phoneNumber' = $${reportQueryParams.length + 1}`);
      reportQueryParams.push(phone_number);
    }
    
    reportLinkQuery += conditions.join(' OR ') + ')';
    
    const matchingReports = await client.query(reportLinkQuery, reportQueryParams);
    
    let linkedReports = [];
    
    if (matchingReports.rows.length > 0) {
      // Update anonymous reports to link them to the new user
      const reportIds = matchingReports.rows.map(report => report.id);
      
      const updateReportsResult = await client.query(
        `UPDATE reports 
         SET user_id = $1, 
             anonymous = false, 
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ANY($2)
         RETURNING id, title, created_at`,
        [userId, reportIds]
      );
      
      linkedReports = updateReportsResult.rows;
      
      console.log(`Linked ${linkedReports.length} anonymous reports to new user ${userId}`);
      
     // IMPORTANT: Remove guest access by deleting verification records
      const deletedVerifications = await client.query(
        `DELETE FROM report_email_verification 
        WHERE report_id = ANY($1) AND (email = $2 OR phone_number = $3)
        RETURNING *`,
        [reportIds, email || null, phone_number || null]
      );
      console.log(`Removed ${deletedVerifications.rows.length} verification records`);
    }
    
    await client.query('COMMIT');
    
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
    
    // Send notification about linked reports if any
    if (linkedReports.length > 0) {
      try {
        const notificationService = require('../services/notificationService');
        await notificationService.createAndSendNotification(
          userId,
          'Reports Linked to Account',
          `${linkedReports.length} of your previous anonymous reports have been linked to your new account`,
          'reports_linked',
          'user_account',
          userId
        );
      } catch (notificationError) {
        console.error('Error sending linking notification:', notificationError);
        // Continue even if notification fails
      }
    }
    
    return res.status(201).json({
      success: true,
      user: {
        id: newUser.rows[0].id,
        username: newUser.rows[0].username,
        email: newUser.rows[0].email,
        phone_number: newUser.rows[0].phone_number,
        full_name: newUser.rows[0].full_name,
        address: newUser.rows[0].address,
        is_admin: newUser.rows[0].is_admin,
        profile_picture: newUser.rows[0].profile_picture
      },
      linkedReports: {
        count: linkedReports.length,
        reports: linkedReports.map(report => ({
          id: report.id,
          title: report.title,
          created_at: report.created_at
        }))
      },
      guestAccessRevoked: linkedReports.length > 0,
      message: linkedReports.length > 0 
        ? `Account created successfully! ${linkedReports.length} previous anonymous reports have been linked to your account. Guest access codes have been revoked.`
        : 'Account created successfully!'
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error registering user:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error registering user',
      error: error.message
    });
  } finally {
    client.release();
  }
}
  
  // Login user with email OR phone number - WITH AGENCY INFO
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
      
      // Get agency information for the user
      const agencyInfo = await db.query(
        `SELECT 
          ac.agency_id,
          a.name as agency_name,
          a.agency_notes,
          a.status as agency_status,
          a.address as agency_address,
          ac.created_at as agency_contact_created
        FROM agency_contacts ac
        JOIN agencies a ON ac.agency_id = a.id
        WHERE ac.user_id = $1`,
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
      
      // Prepare user object with agency information
      const userResponse = {
        id: user.rows[0].id,
        username: user.rows[0].username,
        email: user.rows[0].email,
        phone_number: user.rows[0].phone_number,
        full_name: user.rows[0].full_name,
        is_admin: user.rows[0].is_admin,
        is_master_admin: user.rows[0].is_master_admin,
        is_agency_user: user.rows[0].is_agency_user,
        profile_picture: user.rows[0].profile_picture,
        // Add agency information
        agency_id: agencyInfo.rows.length > 0 ? agencyInfo.rows[0].agency_id : null,
        agency_info: agencyInfo.rows.length > 0 ? {
          id: agencyInfo.rows[0].agency_id,
          name: agencyInfo.rows[0].agency_name,
          notes: agencyInfo.rows[0].agency_notes,
          status: agencyInfo.rows[0].agency_status,
          address: agencyInfo.rows[0].agency_address,
          contact_created_at: agencyInfo.rows[0].agency_contact_created
        } : null
      };
      
      return res.status(200).json({
        success: true,
        user: userResponse
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

  async adminLogin(req, res) {
    const { email, password } = req.body;
  
    try {
      const userResult = await db.query(
        'SELECT * FROM users WHERE email = $1 AND is_admin = true',
        [email]
      );
      const user = userResult.rows[0];
  
      if (!user || !await bcrypt.compare(password, user.password_hash)) {
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
      }
  
      // Get agency information for admin user
      const agencyInfo = await db.query(
        `SELECT 
          ac.agency_id,
          a.name as agency_name,
          a.agency_notes,
          a.status as agency_status,
          a.address as agency_address,
          ac.created_at as agency_contact_created
        FROM agency_contacts ac
        JOIN agencies a ON ac.agency_id = a.id
        WHERE ac.user_id = $1`,
        [user.id]
      );
  
      const token = jwt.sign(
        { id: user.id },
        process.env.JWT_SECRET,
        { expiresIn: '1d' }
      );
  
      // Set as cookie for authentication
      res.cookie('auth_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        maxAge: 24 * 60 * 60 * 1000,
        path: '/'
      });
  
      // Prepare admin user response with agency info
      const userResponse = {
        id: user.id,
        email: user.email,
        username: user.username,
        full_name: user.full_name,
        is_admin: true,
        is_master_admin: user.is_master_admin,
        // Add agency information
        agency_id: agencyInfo.rows.length > 0 ? agencyInfo.rows[0].agency_id : null,
        agency_info: agencyInfo.rows.length > 0 ? {
          id: agencyInfo.rows[0].agency_id,
          name: agencyInfo.rows[0].agency_name,
          notes: agencyInfo.rows[0].agency_notes,
          status: agencyInfo.rows[0].agency_status,
          address: agencyInfo.rows[0].agency_address,
          contact_created_at: agencyInfo.rows[0].agency_contact_created
        } : null
      };
  
      return res.status(200).json({
        success: true,
        user: userResponse
      });
    } catch (error) {
      console.error('Error in adminLogin:', error);
      return res.status(500).json({ success: false, message: 'Server error' });
    }
  }

  // Enhanced Google OAuth callback handler - WITH AGENCY INFO
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
      
      // Get agency information for the user
      const agencyInfo = await db.query(
        `SELECT 
          ac.agency_id,
          a.name as agency_name,
          a.agency_notes,
          a.status as agency_status,
          a.address as agency_address,
          ac.created_at as agency_contact_created
        FROM agency_contacts ac
        JOIN agencies a ON ac.agency_id = a.id
        WHERE ac.user_id = $1`,
        [user.rows[0].id]
      );
      
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
      
      // Prepare user response with agency information
      const userResponse = {
        id: user.rows[0].id,
        email: user.rows[0].email,
        full_name: user.rows[0].full_name,
        profile_picture: user.rows[0].profile_picture,
        username: user.rows[0].username,
        phone_number: user.rows[0].phone_number,
        is_admin: user.rows[0].is_admin,
        is_master_admin: user.rows[0].is_master_admin,
        // Add agency information
        agency_id: agencyInfo.rows.length > 0 ? agencyInfo.rows[0].agency_id : null,
        agency_info: agencyInfo.rows.length > 0 ? {
          id: agencyInfo.rows[0].agency_id,
          name: agencyInfo.rows[0].agency_name,
          notes: agencyInfo.rows[0].agency_notes,
          status: agencyInfo.rows[0].agency_status,
          address: agencyInfo.rows[0].agency_address,
          contact_created_at: agencyInfo.rows[0].agency_contact_created
        } : null
      };
      
      return res.status(200).json({
        success: true,
        message: 'Google authentication successful',
        user: userResponse
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

  async updateProfile(req, res) {
    const client = await db.connect(); // Corrected: get a pooled client
  
    try {
      await client.query('BEGIN');
  
      const userId = req.user.id;
      const { username, email, phone_number, full_name, address } = req.body;
  
      console.log('Updating profile for user:', userId, 'with data:', req.body);
  
      if (!username && !email && !phone_number && !full_name && !address) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'At least one field must be provided for update'
        });
      }
  
      if (email || phone_number) {
        let checkQuery = 'SELECT id FROM users WHERE id != $1 AND (';
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
        const existingUser = await client.query(checkQuery, checkParams);
  
        if (existingUser.rows.length > 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: 'Email or phone number already exists for another user'
          });
        }
      }
  
      const updateFields = [];
      const updateParams = [];
      let paramCount = 1;
  
      if (username !== undefined) {
        updateFields.push(`username = $${paramCount++}`);
        updateParams.push(username);
      }
  
      if (email !== undefined) {
        updateFields.push(`email = $${paramCount++}`);
        updateParams.push(email);
      }
  
      if (phone_number !== undefined) {
        updateFields.push(`phone_number = $${paramCount++}`);
        updateParams.push(phone_number);
      }
  
      if (full_name !== undefined) {
        updateFields.push(`full_name = $${paramCount++}`);
        updateParams.push(full_name);
      }
  
      if (address !== undefined) {
        updateFields.push(`address = $${paramCount++}`);
        updateParams.push(address);
      }
  
      updateFields.push('updated_at = CURRENT_TIMESTAMP');
      updateParams.push(userId); // This goes in the WHERE clause
  
      const updateQuery = `
        UPDATE users SET 
          ${updateFields.join(', ')}
        WHERE id = $${paramCount}
        RETURNING id, username, email, phone_number, full_name, address, is_admin, profile_picture, updated_at
      `;
  
      const updatedUser = await client.query(updateQuery, updateParams);
  
      if (updatedUser.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }
  
      await client.query('COMMIT');
  
      return res.status(200).json({
        success: true,
        user: updatedUser.rows[0],
        message: 'Profile updated successfully'
      });
  
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error updating profile:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error updating profile',
        error: error.message
      });
    } finally {
      client.release(); // Release client back to pool
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
  
  // Get current user with all profile fields including agency info
  async getCurrentUser(req, res) {
    try {
      console.log('Get current user request received for user ID:', req.user.id);
      
      const user = await db.query(
        `SELECT 
          id, 
          username, 
          email, 
          phone_number, 
          full_name, 
          address,
          is_admin, 
          is_master_admin,
          profile_picture, 
          google_id,
          created_at,
          updated_at
        FROM users 
        WHERE id = $1`,
        [req.user.id]
      );
      
      if (user.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }
      
      // Get agency information for the user
      const agencyInfo = await db.query(
        `SELECT 
          ac.agency_id,
          a.name as agency_name,
          a.agency_notes,
          a.status as agency_status,
          a.address as agency_address,
          ac.created_at as agency_contact_created
        FROM agency_contacts ac
        JOIN agencies a ON ac.agency_id = a.id
        WHERE ac.user_id = $1`,
        [req.user.id]
      );
      
      console.log('User data retrieved:', user.rows[0]);
      
      // Prepare user response with agency information
      const userResponse = {
        ...user.rows[0],
        // Add agency information
        agency_id: agencyInfo.rows.length > 0 ? agencyInfo.rows[0].agency_id : null,
        agency_info: agencyInfo.rows.length > 0 ? {
          id: agencyInfo.rows[0].agency_id,
          name: agencyInfo.rows[0].agency_name,
          notes: agencyInfo.rows[0].agency_notes,
          status: agencyInfo.rows[0].agency_status,
          address: agencyInfo.rows[0].agency_address,
          contact_created_at: agencyInfo.rows[0].agency_contact_created
        } : null
      };
      
      return res.status(200).json({
        success: true,
        user: userResponse
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