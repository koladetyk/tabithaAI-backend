const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const generatePassword = require('../utils/generatePassword');
const sendTempPasswordEmail = require('../utils/sendTempPasswordEmail'); // optional but recommended

// Add a new contact person to an existing agency - IMPROVED ERROR HANDLING + DUPLICATE CHECK
exports.addContactPerson = async (req, res) => {
  const agencyId = req.params.id;
  const { full_name, email, phone_number } = req.body;

  if (!full_name || !email || !phone_number) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  const client = await db.connect();
  let tempPassword = null;
  let userId = null;

  try {
    await client.query('BEGIN');

    // Check if user already exists with this email or phone number
    const existingUserCheck = await client.query(
      'SELECT id, email, phone_number, full_name FROM users WHERE email = $1 OR phone_number = $2',
      [email, phone_number]
    );

    if (existingUserCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      const existingUser = existingUserCheck.rows[0];
      return res.status(409).json({ 
        success: false, 
        message: `User already exists with ${existingUser.email === email ? 'email' : 'phone number'}: ${existingUser.email === email ? email : phone_number}`,
        existing_user: {
          id: existingUser.id,
          full_name: existingUser.full_name,
          email: existingUser.email,
          phone_number: existingUser.phone_number
        },
        error_type: 'duplicate_user'
      });
    }

    tempPassword = generatePassword();
    const hashedPassword = await bcrypt.hash(tempPassword, 10);
    userId = uuidv4();
    const username = `${full_name.split(' ')[0].toLowerCase()}${Math.floor(Math.random() * 900 + 100)}`;

    // Create user
    await client.query(
      `INSERT INTO users (id, full_name, username, email, phone_number, password_hash, is_agency_user)
       VALUES ($1, $2, $3, $4, $5, $6, true)`,
      [userId, full_name, username, email, phone_number, hashedPassword]
    );

    // Create agency contact mapping
    await client.query(
      `INSERT INTO agency_contacts (agency_id, user_id) VALUES ($1, $2)`,
      [agencyId, userId]
    );

    // Log the action
    await client.query(
      `INSERT INTO audit_logs (action_type, entity_type, entity_uuid, performed_by, details)
       VALUES ($1, $2, $3, $4, $5)`,
      ['ADD', 'CONTACT', userId, req.user.id, `Added contact ${email} to agency ${agencyId}`]
    );

    // Commit the database transaction FIRST
    await client.query('COMMIT');
    console.log(`[Admin:${req.user.id}] Database operations completed for contact ${email} to agency ${agencyId}`);

    // THEN attempt to send email (non-critical)
    let emailStatus = 'success';
    let emailError = null;

    try {
      await sendTempPasswordEmail(email, tempPassword);
      console.log(`Password email sent successfully to ${email}`);
    } catch (emailErr) {
      emailStatus = 'failed';
      emailError = emailErr.message;
      console.error(`Failed to send email to ${email}:`, emailErr.message);
      console.log(`MANUAL DELIVERY NEEDED - Password for ${email}: ${tempPassword}`);
      
      // Log email failure for follow-up
      await db.query(
        `INSERT INTO audit_logs (action_type, entity_type, entity_uuid, performed_by, details)
         VALUES ($1, $2, $3, $4, $5)`,
        ['EMAIL_FAILED', 'CONTACT', userId, req.user.id, 
         `Email delivery failed for ${email}. Manual delivery required. Error: ${emailErr.message}`]
      );
    }

    // Return success regardless of email status
    const responseData = {
      success: true,
      message: 'Contact person added successfully',
      contact: {
        id: userId,
        email: email,
        full_name: full_name
      },
      email_delivery: {
        status: emailStatus,
        message: emailStatus === 'success' 
          ? 'Password email sent successfully'
          : 'Email delivery failed - password logged for manual delivery'
      }
    };

    // Include temp password in response if email failed (for development/testing)
    if (emailStatus === 'failed' && process.env.NODE_ENV !== 'production') {
      responseData.temp_password_for_manual_delivery = tempPassword;
      responseData.email_error = emailError;
    }

    return res.status(201).json(responseData);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error in addContactPerson:', err);
    
    // Enhanced error handling
    let errorMessage = 'Add contact failed';
    let statusCode = 500;
    
    // Check for specific PostgreSQL errors
    if (err.code === '23505') { // Unique constraint violation
      if (err.detail.includes('email')) {
        errorMessage = 'A user with this email address already exists';
        statusCode = 409;
      } else if (err.detail.includes('phone_number')) {
        errorMessage = 'A user with this phone number already exists';
        statusCode = 409;
      } else if (err.detail.includes('username')) {
        errorMessage = 'Username already exists (this is auto-generated, please try again)';
        statusCode = 409;
      }
    }
    
    const errorResponse = {
      success: false,
      message: errorMessage,
      error: err.message,
      error_code: err.code || 'UNKNOWN'
    };

    // Include temp password for manual delivery if user was created but something else failed
    if (tempPassword && process.env.NODE_ENV !== 'production') {
      errorResponse.temp_password_for_manual_delivery = tempPassword;
      errorResponse.manual_delivery_note = `If user was created, manual password delivery needed for ${email}`;
    }

    return res.status(statusCode).json(errorResponse);
  } finally {
    client.release();
  }
};

// Admin adds agency and contacts - IMPROVED ERROR HANDLING + DUPLICATE CHECK
exports.addAgency = async (req, res) => {
  const { name, agency_notes, contacts, address } = req.body;

  if (!name || !contacts || !Array.isArray(contacts)) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  const client = await db.connect();
  const contactResults = [];
  const emailFailures = [];
  const duplicateUsers = [];

  try {
    await client.query('BEGIN');

    // Pre-check for duplicate users before creating agency
    for (const contact of contacts) {
      const { email, phone_number } = contact;
      
      const existingUserCheck = await client.query(
        'SELECT id, email, phone_number, full_name FROM users WHERE email = $1 OR phone_number = $2',
        [email, phone_number]
      );

      if (existingUserCheck.rows.length > 0) {
        const existingUser = existingUserCheck.rows[0];
        duplicateUsers.push({
          input_email: email,
          input_phone: phone_number,
          existing_user: {
            id: existingUser.id,
            full_name: existingUser.full_name,
            email: existingUser.email,
            phone_number: existingUser.phone_number
          },
          conflict_type: existingUser.email === email ? 'email' : 'phone_number'
        });
      }
    }

    // If we found duplicates, rollback and return error
    if (duplicateUsers.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: `Cannot create agency. Found ${duplicateUsers.length} existing user(s) with duplicate email/phone numbers.`,
        duplicate_users: duplicateUsers,
        error_type: 'duplicate_users_in_contacts'
      });
    }

    // Create agency
    const agencyResult = await client.query(
      `INSERT INTO agencies (name, agency_notes, address, status, updated_at)
       VALUES ($1, $2, $3, 'Active', CURRENT_DATE) RETURNING id`,
      [name, agency_notes, address]
    );
    const agencyId = agencyResult.rows[0].id;

    // Process each contact (now safe since we pre-checked for duplicates)
    for (const contact of contacts) {
      const { full_name, email, phone_number } = contact;
      const tempPassword = generatePassword();
      const hashedPassword = await bcrypt.hash(tempPassword, 10);
      const userId = uuidv4();
      const randomDigits = Math.floor(100 + Math.random() * 900);
      const username = full_name.toLowerCase().replace(/\s+/g, '_') + randomDigits;

      // Create user
      await client.query(
        `INSERT INTO users (id, username, full_name, email, phone_number, password_hash, is_agency_user)
         VALUES ($1, $2, $3, $4, $5, $6, true)`,
        [userId, username, full_name, email, phone_number, hashedPassword]
      );

      // Create agency contact mapping
      await client.query(
        `INSERT INTO agency_contacts (agency_id, user_id) VALUES ($1, $2)`,
        [agencyId, userId]
      );

      contactResults.push({
        userId,
        email,
        full_name,
        tempPassword,
        emailSent: false
      });
    }

    // Log agency creation
    await client.query(
      `INSERT INTO audit_logs (action_type, entity_type, entity_int_id, performed_by, details)
       VALUES ($1, $2, $3, $4, $5)`,
      ['ADD', 'AGENCY', agencyId, req.user.id, `Created agency "${name}" with ${contacts.length} contacts`]
    );

    // Commit database transaction FIRST
    await client.query('COMMIT');
    console.log(`Agency ${name} created successfully with ${contacts.length} contacts`);

    // THEN attempt to send emails to all contacts (non-critical)
    for (const contactResult of contactResults) {
      try {
        await sendTempPasswordEmail(contactResult.email, contactResult.tempPassword);
        contactResult.emailSent = true;
        console.log(`Password email sent successfully to ${contactResult.email}`);
      } catch (emailErr) {
        contactResult.emailSent = false;
        contactResult.emailError = emailErr.message;
        emailFailures.push({
          email: contactResult.email,
          error: emailErr.message,
          tempPassword: contactResult.tempPassword
        });
        
        console.error(`Failed to send email to ${contactResult.email}:`, emailErr.message);
        console.log(`MANUAL DELIVERY NEEDED - Password for ${contactResult.email}: ${contactResult.tempPassword}`);
        
        // Log email failure
        await db.query(
          `INSERT INTO audit_logs (action_type, entity_type, entity_uuid, performed_by, details)
           VALUES ($1, $2, $3, $4, $5)`,
          ['EMAIL_FAILED', 'CONTACT', contactResult.userId, req.user.id, 
           `Email delivery failed for ${contactResult.email}. Manual delivery required. Error: ${emailErr.message}`]
        );
      }
    }

    // Prepare response
    const emailsSent = contactResults.filter(c => c.emailSent).length;
    const emailsFailed = contactResults.filter(c => !c.emailSent).length;

    const responseData = {
      success: true,
      message: `Agency and contacts added successfully. ${emailsSent} emails sent, ${emailsFailed} failed.`,
      agency: {
        id: agencyId,
        name: name,
        contacts_created: contactResults.length
      },
      email_delivery: {
        total_contacts: contactResults.length,
        emails_sent: emailsSent,
        emails_failed: emailsFailed,
        failures: emailFailures.map(f => ({
          email: f.email,
          error: f.error
        }))
      }
    };

    // Include temp passwords in response if in development and there were failures
    if (emailsFailed > 0 && process.env.NODE_ENV !== 'production') {
      responseData.manual_delivery_passwords = emailFailures.map(f => ({
        email: f.email,
        temp_password: f.tempPassword
      }));
    }

    return res.status(201).json(responseData);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creating agency:', err);

    // Enhanced error handling for specific database errors
    let errorMessage = 'Server error';
    let statusCode = 500;
    
    if (err.code === '23505') { // Unique constraint violation
      if (err.detail.includes('email')) {
        errorMessage = 'One or more contacts have duplicate email addresses';
        statusCode = 409;
      } else if (err.detail.includes('phone_number')) {
        errorMessage = 'One or more contacts have duplicate phone numbers';
        statusCode = 409;
      }
    }

    const errorResponse = {
      success: false,
      message: errorMessage,
      error: err.message,
      error_code: err.code || 'UNKNOWN'
    };

    // Include created temp passwords for manual delivery if needed
    if (contactResults.length > 0 && process.env.NODE_ENV !== 'production') {
      errorResponse.partial_contact_passwords = contactResults.map(c => ({
        email: c.email,
        temp_password: c.tempPassword
      }));
      errorResponse.manual_delivery_note = 'If any users were created before error, manual password delivery may be needed';
    }

    return res.status(statusCode).json(errorResponse);
  } finally {
    client.release();
  }
};

// Admin updates agency info (including status)
exports.updateAgency = async (req, res) => {
  const agencyId = parseInt(req.params.id);
  const { name, agency_notes, address, status } = req.body;

  if (isNaN(agencyId)) {
    return res.status(400).json({ success: false, message: 'Invalid agency ID' });
  }

  // Validate that at least one field is provided for update
  if (!name && !agency_notes && address === undefined && !status) {
    return res.status(400).json({ 
      success: false, 
      message: 'At least one field (name, agency_notes, address, or status) must be provided for update' 
    });
  }

  // Validate status if provided
  if (status && !['Active', 'Inactive'].includes(status)) {
    return res.status(400).json({ 
      success: false, 
      message: 'Status must be either "Active" or "Inactive"' 
    });
  }

  try {
    // Check if agency exists
    const agencyCheck = await db.query('SELECT id, name FROM agencies WHERE id = $1', [agencyId]);

    if (agencyCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Agency not found' });
    }

    // Build dynamic update query
    const updateFields = [];
    const updateParams = [];
    let paramCount = 1;

    if (name !== undefined) {
      updateFields.push(`name = $${paramCount++}`);
      updateParams.push(name);
    }

    if (agency_notes !== undefined) {
      updateFields.push(`agency_notes = $${paramCount++}`);
      updateParams.push(agency_notes);
    }

    if (address !== undefined) {
      updateFields.push(`address = $${paramCount++}`);
      updateParams.push(address);
    }

    if (status !== undefined) {
      updateFields.push(`status = $${paramCount++}`);
      updateParams.push(status);
    }

    // Always update the updated_at field
    updateFields.push('updated_at = CURRENT_DATE');
    updateParams.push(agencyId); // For WHERE clause

    const updateQuery = `
      UPDATE agencies SET 
        ${updateFields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING id, name, agency_notes, address, status, updated_at
    `;

    const result = await db.query(updateQuery, updateParams);

    // Log audit trail
    await db.query(
      `INSERT INTO audit_logs (action_type, entity_type, entity_int_id, performed_by, details)
       VALUES ($1, $2, $3, $4, $5)`,
      ['UPDATE', 'AGENCY', agencyId, req.user.id, `Updated agency "${result.rows[0].name}"${status ? ` - status set to ${status}` : ''}`]
    );

    return res.status(200).json({ 
      success: true, 
      message: 'Agency updated successfully',
      agency: result.rows[0]
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Update failed', error: err.message });
  }
};
  
  // Delete a contact person from an agency (removes mapping + user if agency user)
  exports.deleteContactPerson = async (req, res) => {
    const { agencyId, userId } = req.params;
  
    const client = await db.connect();
    try {
      await client.query('BEGIN');
  
      await client.query(
        `DELETE FROM agency_contacts WHERE agency_id = $1 AND user_id = $2`,
        [agencyId, userId]
      );
  
      await client.query(
        `DELETE FROM users WHERE id = $1 AND is_agency_user = true`,
        [userId]
      );

      await client.query(
        `INSERT INTO audit_logs (action_type, entity_type, entity_uuid, performed_by, details)
         VALUES ($1, $2, $3, $4, $5)`,
        ['DELETE', 'CONTACT', userId, req.user.id, `Deleted contact ${userId} from agency ${agencyId}`]
      );
      
      
  
      await client.query('COMMIT');
  
      console.log(`[Admin:${req.user.id}] Deleted contact ${userId} from agency ${agencyId}`);
      return res.status(200).json({ success: true, message: 'Contact person deleted' });
  
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(err);
      return res.status(500).json({ success: false, message: 'Delete contact failed', error: err.message });
    } finally {
      client.release();
    }
  };
  
 // Update to deleteAgency to include referrals, agency_contacts and users cleanup + logging
exports.deleteAgency = async (req, res) => {
  const agencyId = req.params.id;
  
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    
    // First, get all users associated with this agency for logging purposes
    const associatedUsers = await client.query(
      `SELECT u.id, u.email, u.full_name 
       FROM users u 
       JOIN agency_contacts ac ON u.id = ac.user_id 
       WHERE ac.agency_id = $1 AND u.is_agency_user = true`,
      [agencyId]
    );
    
    // Get referrals count for logging
    const referralsResult = await client.query(
      'SELECT COUNT(*) as count FROM referrals WHERE agency_id = $1',
      [agencyId]
    );
    const referralsCount = parseInt(referralsResult.rows[0].count);
    
    // Delete referrals first (to handle foreign key constraint)
    await client.query('DELETE FROM referrals WHERE agency_id = $1', [agencyId]);
    
    // Delete agency users who are marked as agency-only users
    await client.query(
      `DELETE FROM users 
       WHERE id IN (
         SELECT u.id 
         FROM users u 
         JOIN agency_contacts ac ON u.id = ac.user_id 
         WHERE ac.agency_id = $1 AND u.is_agency_user = true
       )`,
      [agencyId]
    );
    
    // Delete agency contacts (this will handle any remaining contacts)
    await client.query('DELETE FROM agency_contacts WHERE agency_id = $1', [agencyId]);
    
    // Delete the agency itself
    const deletedAgency = await client.query(
      'DELETE FROM agencies WHERE id = $1 RETURNING name',
      [agencyId]
    );
    
    if (deletedAgency.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ 
        success: false, 
        message: 'Agency not found' 
      });
    }
    
    // Log the deletion with details about deleted users and referrals
    await client.query(
      `INSERT INTO audit_logs (action_type, entity_type, entity_int_id, performed_by, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        'DELETE', 
        'AGENCY', 
        agencyId, 
        req.user.id, 
        `Deleted agency ${agencyId} (${deletedAgency.rows[0].name}), ${associatedUsers.rows.length} users, and ${referralsCount} referrals`
      ]
    );
    
    await client.query('COMMIT');
    
    console.log(`[Admin:${req.user.id}] Deleted agency ${agencyId}, ${associatedUsers.rows.length} users, and ${referralsCount} referrals`);
    
    return res.status(200).json({ 
      success: true, 
      message: `Agency, ${associatedUsers.rows.length} users, and ${referralsCount} referrals deleted successfully`,
      deleted_users_count: associatedUsers.rows.length,
      deleted_referrals_count: referralsCount,
      deleted_agency_name: deletedAgency.rows[0].name
    });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error deleting agency:', err);
    return res.status(500).json({ 
      success: false, 
      message: 'Deletion failed', 
      error: err.message 
    });
  } finally {
    client.release();
  }
};

// Edit/Update a contact person's information
exports.updateContactPerson = async (req, res) => {
  const { agencyId, userId } = req.params;
  const { username, full_name, email, phone_number, address } = req.body;

  // Parse agencyId to integer to ensure proper type
  const parsedAgencyId = parseInt(agencyId);
  
  if (isNaN(parsedAgencyId)) {
    return res.status(400).json({ 
      success: false, 
      message: 'Invalid agency ID' 
    });
  }

  if (!username && !full_name && !email && !phone_number && !address) {
    return res.status(400).json({ 
      success: false, 
      message: 'At least one field (username, full_name, email, phone_number, or address) must be provided' 
    });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Verify the contact person exists and belongs to the agency
    const contactCheck = await client.query(
      `SELECT u.id, u.username, u.full_name, u.email, u.phone_number, u.address 
       FROM users u
       JOIN agency_contacts ac ON u.id = ac.user_id
       WHERE u.id = $1 AND ac.agency_id = $2 AND u.is_agency_user = true`,
      [userId, parsedAgencyId]
    );

    if (contactCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ 
        success: false, 
        message: 'Contact person not found for this agency' 
      });
    }

    // Check for conflicts with email or username ONLY (removed phone_number)
    if (email || username) {
      let checkQuery = 'SELECT id FROM users WHERE id != $1 AND (';
      const checkParams = [userId];
      const conditions = [];

      if (email && email !== contactCheck.rows[0].email) {
        conditions.push(`email = $${checkParams.length + 1}`);
        checkParams.push(email);
      }

      if (username && username !== contactCheck.rows[0].username) {
        conditions.push(`username = $${checkParams.length + 1}`);
        checkParams.push(username);
      }

      if (conditions.length > 0) {
        checkQuery += conditions.join(' OR ') + ')';
        const existingUser = await client.query(checkQuery, checkParams);

        if (existingUser.rows.length > 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ 
            success: false, 
            message: 'Username or email already exists for another user' 
          });
        }
      }
    }

    // Build dynamic update query (unchanged - all fields can still be updated)
    const updateFields = [];
    const updateParams = [];
    let paramCount = 1;

    if (username !== undefined) {
      updateFields.push(`username = $${paramCount++}`);
      updateParams.push(username);
    }

    if (full_name !== undefined) {
      updateFields.push(`full_name = $${paramCount++}`);
      updateParams.push(full_name);
    }

    if (email !== undefined) {
      updateFields.push(`email = $${paramCount++}`);
      updateParams.push(email);
    }

    if (phone_number !== undefined) {
      updateFields.push(`phone_number = $${paramCount++}`);
      updateParams.push(phone_number);
    }

    if (address !== undefined) {
      updateFields.push(`address = $${paramCount++}`);
      updateParams.push(address);
    }

    // Add updated_at and user ID
    updateFields.push('updated_at = CURRENT_TIMESTAMP');
    updateParams.push(userId);

    const updateQuery = `
      UPDATE users SET 
        ${updateFields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING id, username, full_name, email, phone_number, address, updated_at
    `;

    const updatedUser = await client.query(updateQuery, updateParams);

    // Log the update
    await client.query(
      `INSERT INTO audit_logs (action_type, entity_type, entity_uuid, performed_by, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        'UPDATE', 
        'CONTACT', 
        userId, 
        req.user.id, 
        `Updated contact ${updatedUser.rows[0].email} in agency ${parsedAgencyId}`
      ]
    );

    await client.query('COMMIT');

    console.log(`[Admin:${req.user.id}] Updated contact ${userId} in agency ${parsedAgencyId}`);
    
    return res.status(200).json({ 
      success: true, 
      message: 'Contact person updated successfully',
      contact: updatedUser.rows[0]
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error updating contact person:', err);
    return res.status(500).json({ 
      success: false, 
      message: 'Update contact failed', 
      error: err.message 
    });
  } finally {
    client.release();
  }
};

// View agencies and contact persons - FIXED to return empty array when no contacts
exports.getAgencies = async (req, res) => {
  try {
    const agencies = await db.query(`
      SELECT a.*, 
      CASE 
        WHEN COUNT(u.id) = 0 THEN '[]'::json
        ELSE json_agg(
          json_build_object(
            'user_id', u.id,
            'full_name', u.full_name,
            'email', u.email,
            'phone_number', u.phone_number
          )
        )
      END AS contacts
      FROM agencies a
      LEFT JOIN agency_contacts ac ON ac.agency_id = a.id
      LEFT JOIN users u ON ac.user_id = u.id
      GROUP BY a.id
    `);

    return res.status(200).json({ success: true, agencies: agencies.rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Error fetching agencies', error: err.message });
  }
};

exports.getAgencyById = async (req, res) => {
  const agencyId = parseInt(req.params.id);
  if (isNaN(agencyId)) {
    return res.status(400).json({ success: false, message: 'Invalid agency ID' });
  }

  try {
    const agency = await db.query(`
      SELECT a.*, 
      CASE 
        WHEN COUNT(u.id) = 0 THEN '[]'::json
        ELSE json_agg(
          json_build_object(
            'user_id', u.id,
            'full_name', u.full_name,
            'email', u.email,
            'phone_number', u.phone_number
          )
        )
      END AS contacts
      FROM agencies a
      LEFT JOIN agency_contacts ac ON ac.agency_id = a.id
      LEFT JOIN users u ON ac.user_id = u.id
      WHERE a.id = $1
      GROUP BY a.id
    `, [agencyId]);

    if (agency.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Agency not found' });
    }

    return res.status(200).json({ success: true, agency: agency.rows[0] });

  } catch (err) {
    return res.status(500).json({ success: false, message: 'Error fetching agency', error: err.message });
  }
};

// PATCH /agencies/:id/status
exports.toggleAgencyStatus = async (req, res) => {
  const agencyId = parseInt(req.params.id);
  const { status } = req.body;

  if (isNaN(agencyId) || !['Active', 'Inactive'].includes(status)) {
    return res.status(400).json({ success: false, message: 'Invalid input' });
  }

  try {
    const result = await db.query(
      `UPDATE agencies SET status = $1, updated_at = CURRENT_DATE WHERE id = $2 RETURNING id, name`,
      [status, agencyId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Agency not found' });
    }

    await db.query(
      `INSERT INTO audit_logs (action_type, entity_type, entity_int_id, performed_by, details)
       VALUES ($1, $2, $3, $4, $5)`,
      ['UPDATE_STATUS', 'AGENCY', agencyId, req.user.id, `Set status to ${status}`]
    );

    return res.status(200).json({
      success: true,
      message: `Agency status updated to ${status}`,
      agency: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Failed to update status', error: err.message });
  }
};

// GET /agencies/:id/report-summary
exports.getSingleAgencyReportSummary = async (req, res) => {
  const agencyId = req.params.id;

  try {
    const result = await db.query(`
      SELECT 
        a.id AS agency_id,
        a.name AS agency_name,
        COUNT(r.id) AS number_of_reports,
        MAX(r.referral_date) AS last_report_date,
        (
          SELECT r2.referral_status
          FROM referrals r2
          WHERE r2.agency_id = a.id
          ORDER BY r2.referral_date DESC
          LIMIT 1
        ) AS current_status
      FROM agencies a
      LEFT JOIN referrals r ON r.agency_id = a.id
      WHERE a.id = $1
      GROUP BY a.id
      ORDER BY a.id;
    `, [agencyId]);

    res.status(200).json({ success: true, summary: result.rows[0] });
  } catch (err) {
    console.error('Error fetching single agency summary:', err);
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
};

// GET /agencies/collective-summary - Overall statistics across all agencies
exports.getCollectiveAgencySummary = async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        -- Total number of agencies
        (SELECT COUNT(*) FROM agencies) AS total_agencies,
        
        -- Number of active agencies
        (SELECT COUNT(*) FROM agencies WHERE status = 'Active') AS active_agencies,
        
        -- Number of inactive agencies
        (SELECT COUNT(*) FROM agencies WHERE status = 'Inactive') AS inactive_agencies,
        
        -- Total number of reports assigned to agencies
        (SELECT COUNT(*) FROM referrals) AS total_assigned_reports,
        
        -- Number of processed reports (assuming 'completed' or 'resolved' status)
        (SELECT COUNT(*) FROM referrals WHERE referral_status IN ('completed', 'resolved', 'closed')) AS processed_reports,
        
        -- Number of pending reports
        (SELECT COUNT(*) FROM referrals WHERE referral_status IN ('pending', 'in_progress', 'under_review')) AS pending_reports,
        
        -- Total agency contacts/users
        (SELECT COUNT(*) FROM agency_contacts) AS total_agency_contacts,
        
        -- Average reports per agency
        CASE 
          WHEN (SELECT COUNT(*) FROM agencies) > 0 
          THEN ROUND((SELECT COUNT(*) FROM referrals)::decimal / (SELECT COUNT(*) FROM agencies), 2)
          ELSE 0 
        END AS avg_reports_per_agency,
        
        -- Most recent referral date
        (SELECT MAX(referral_date) FROM referrals) AS last_referral_date,
        
        -- Agency with most referrals
        (
          SELECT json_build_object(
            'agency_id', a.id,
            'agency_name', a.name,
            'report_count', COUNT(r.id)
          )
          FROM agencies a
          LEFT JOIN referrals r ON r.agency_id = a.id
          GROUP BY a.id, a.name
          ORDER BY COUNT(r.id) DESC
          LIMIT 1
        ) AS top_agency_by_reports
    `);

    const summary = result.rows[0];
    
    // Calculate processing rate
    const totalReports = parseInt(summary.total_assigned_reports) || 0;
    const processedReports = parseInt(summary.processed_reports) || 0;
    const processingRate = totalReports > 0 ? 
      Math.round((processedReports / totalReports) * 100) : 0;

    const response = {
      total_agencies: parseInt(summary.total_agencies) || 0,
      active_agencies: parseInt(summary.active_agencies) || 0,
      inactive_agencies: parseInt(summary.inactive_agencies) || 0,
      total_assigned_reports: totalReports,
      processed_reports: processedReports,
      pending_reports: parseInt(summary.pending_reports) || 0,
      processing_rate_percentage: processingRate,
      total_agency_contacts: parseInt(summary.total_agency_contacts) || 0,
      avg_reports_per_agency: parseFloat(summary.avg_reports_per_agency) || 0,
      last_referral_date: summary.last_referral_date,
      top_agency_by_reports: summary.top_agency_by_reports || null
    };

    res.status(200).json({ 
      success: true, 
      collective_summary: response 
    });

  } catch (err) {
    console.error('Error fetching collective agency summary:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Server error fetching collective summary', 
      error: err.message 
    });
  }
};



// Updated getReferredReportsForAgency with agency user filtering and pagination
exports.getReferredReportsForAgency = async (req, res) => {
  const agencyId = req.params.id;
  const { page = 1, limit = 10, status, date_range, start_date, end_date, search } = req.query;
  const offset = (page - 1) * limit;

  try {
    // If user is agency user (not admin), verify they belong to this agency
    if (req.user.is_agency_user && !req.user.is_admin) {
      const userAgency = await db.query(
        'SELECT agency_id FROM agency_contacts WHERE user_id = $1',
        [req.user.id]
      );

      if (userAgency.rows.length === 0 || userAgency.rows[0].agency_id != agencyId) {
        return res.status(403).json({
          success: false,
          message: 'You can only view reports for your assigned agency'
        });
      }
    }

    // Build query with filters
    let query = `SELECT 
      r.*,
      rep.title,
      rep.incident_type,
      rep.incident_description,
      rep.created_at as report_created_at
     FROM referrals r
     JOIN reports rep ON r.report_id = rep.id
     WHERE r.agency_id = $1`;
     
    let countQuery = `SELECT COUNT(*) 
     FROM referrals r
     JOIN reports rep ON r.report_id = rep.id
     WHERE r.agency_id = $1`;
     
    let queryParams = [agencyId];
    let conditions = [];

    // Add status filter
    if (status) {
      conditions.push('r.referral_status = $' + (queryParams.length + 1));
      queryParams.push(status);
    }

    // Add date range filtering
    if (date_range) {
      let dateCondition = '';
      const now = new Date();
      
      switch (date_range) {
        case '7days':
          const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          dateCondition = 'r.referral_date >= $' + (queryParams.length + 1);
          queryParams.push(sevenDaysAgo.toISOString());
          break;
          
        case '30days':
          const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          dateCondition = 'r.referral_date >= $' + (queryParams.length + 1);
          queryParams.push(thirtyDaysAgo.toISOString());
          break;
          
        case '90days':
          const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
          dateCondition = 'r.referral_date >= $' + (queryParams.length + 1);
          queryParams.push(ninetyDaysAgo.toISOString());
          break;
          
        case 'thisyear':
          const yearStart = new Date(now.getFullYear(), 0, 1);
          dateCondition = 'r.referral_date >= $' + (queryParams.length + 1);
          queryParams.push(yearStart.toISOString());
          break;
      }
      
      if (dateCondition) {
        conditions.push(dateCondition);
      }
    }

    // Add custom date range filtering
    if (start_date || end_date) {
      if (start_date) {
        conditions.push('r.referral_date >= $' + (queryParams.length + 1));
        queryParams.push(new Date(start_date).toISOString());
      }
      if (end_date) {
        const endDateTime = new Date(end_date);
        endDateTime.setDate(endDateTime.getDate() + 1);
        conditions.push('r.referral_date < $' + (queryParams.length + 1));
        queryParams.push(endDateTime.toISOString());
      }
    }

    // Add search functionality
    if (search) {
      const searchTerm = `%${search.trim()}%`;
      conditions.push(
        '(rep.title ILIKE $' + (queryParams.length + 1) + 
        ' OR rep.incident_description ILIKE $' + (queryParams.length + 2) + 
        ' OR r.notes ILIKE $' + (queryParams.length + 3) + ')'
      );
      queryParams.push(searchTerm, searchTerm, searchTerm);
    }

    // Add conditions to queries
    if (conditions.length > 0) {
      const whereClause = ' AND ' + conditions.join(' AND ');
      query += whereClause;
      countQuery += whereClause;
    }

    // Add pagination
    query += ' ORDER BY r.referral_date DESC LIMIT $' + (queryParams.length + 1) + ' OFFSET $' + (queryParams.length + 2);
    const paginationParams = [...queryParams, limit, offset];

    // Execute queries
    const [result, totalCount] = await Promise.all([
      db.query(query, paginationParams),
      db.query(countQuery, queryParams)
    ]);

    return res.status(200).json({
      success: true,
      data: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(totalCount.rows[0].count),
        pages: Math.ceil(totalCount.rows[0].count / limit)
      },
      filters: {
        status: status || null,
        date_range: date_range || null,
        start_date: start_date || null,
        end_date: end_date || null,
        search: search || null
      },
      userType: req.user.is_admin ? 'admin' : 'agency_user',
      agencyId: agencyId
    });

  } catch (err) {
    console.error('Error fetching referred reports:', err);
    return res.status(500).json({
      success: false,
      message: 'Error retrieving referred reports',
      error: err.message,
    });
  }
};

