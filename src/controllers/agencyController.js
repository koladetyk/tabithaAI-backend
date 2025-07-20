const db = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const generatePassword = require('../utils/generatePassword');
const sendTempPasswordEmail = require('../utils/sendTempPasswordEmail'); // optional but recommended

// Admin adds agency and contacts
exports.addAgency = async (req, res) => {
  const { name, agency_notes, contacts, address } = req.body;

  if (!name || !contacts || !Array.isArray(contacts)) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Include status and updated_at explicitly
    const agencyResult = await client.query(
      `INSERT INTO agencies (name, agency_notes, address, status, updated_at)
       VALUES ($1, $2, $3, 'Active', CURRENT_DATE) RETURNING id`,
      [name, agency_notes, address]
    );
    const agencyId = agencyResult.rows[0].id;

    for (const contact of contacts) {
      const { full_name, email, phone_number } = contact;

      const tempPassword = generatePassword();
      const hashedPassword = await bcrypt.hash(tempPassword, 10);
      const userId = uuidv4();

      const randomDigits = Math.floor(100 + Math.random() * 900);
      const username = full_name.toLowerCase().replace(/\s+/g, '_') + randomDigits;

      await client.query(
        `INSERT INTO users (id, username, full_name, email, phone_number, password_hash, is_agency_user)
         VALUES ($1, $2, $3, $4, $5, $6, true)`,
        [userId, username, full_name, email, phone_number, hashedPassword]
      );

      await client.query(
        `INSERT INTO agency_contacts (agency_id, user_id) VALUES ($1, $2)`,
        [agencyId, userId]
      );

      await client.query(
        `INSERT INTO audit_logs (action_type, entity_type, entity_int_id, performed_by, details)
         VALUES ($1, $2, $3, $4, $5)`,
        ['ADD', 'AGENCY', agencyId, req.user.id, `Created agency "${name}"`]
      );

      try {
        await sendTempPasswordEmail(email, tempPassword);
      } catch (emailErr) {
        console.error(`Failed to send email to ${email}:`, emailErr.message);
      }
    }

    await client.query('COMMIT');
    return res.status(201).json({ success: true, message: 'Agency and contacts added successfully' });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error', error: err.message });
  } finally {
    client.release();
  }
};

  

// Admin updates agency info
exports.updateAgency = async (req, res) => {
  const agencyId = parseInt(req.params.id);
  const { name, agency_notes, address } = req.body;

  if (isNaN(agencyId)) {
    return res.status(400).json({ success: false, message: 'Invalid agency ID' });
  }

  try {
    // Check if agency exists
    const agencyCheck = await db.query('SELECT id FROM agencies WHERE id = $1', [agencyId]);

    if (agencyCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Agency not found' });
    }

    // Perform update
    await db.query(
      'UPDATE agencies SET name = $1, agency_notes = $2, address = $3, updated_at = CURRENT_DATE WHERE id = $4',
      [name, agency_notes, address, agencyId]
    );  

    // Log audit trail
    await db.query(
      `INSERT INTO audit_logs (action_type, entity_type, entity_int_id, performed_by, details)
       VALUES ($1, $2, $3, $4, $5)`,
      ['UPDATE', 'AGENCY', agencyId, req.user.id, `Updated agency ${name}`]
    );

    return res.status(200).json({ success: true, message: 'Agency updated successfully' });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Update failed', error: err.message });
  }
};  

// Add a new contact person to an existing agency
exports.addContactPerson = async (req, res) => {
    const agencyId = req.params.id;
    const { full_name, email, phone_number } = req.body;
  
    if (!full_name || !email || !phone_number) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }
  
    const client = await db.connect();
    try {
      await client.query('BEGIN');
  
      const tempPassword = generatePassword();
      const hashedPassword = await bcrypt.hash(tempPassword, 10);
      const userId = uuidv4();
      const username = `${full_name.split(' ')[0].toLowerCase()}${Math.floor(Math.random() * 900 + 100)}`;
  
      await client.query(
        `INSERT INTO users (id, full_name, username, email, phone_number, password_hash, is_agency_user)
         VALUES ($1, $2, $3, $4, $5, $6, true)`,
        [userId, full_name, username, email, phone_number, hashedPassword]
      );

      await client.query(
        `INSERT INTO audit_logs (action_type, entity_type, entity_uuid, performed_by, details)
         VALUES ($1, $2, $3, $4, $5)`,
        ['ADD', 'CONTACT', userId, req.user.id, `Added contact ${email} to agency ${agencyId}`]
      );
      
      
  
      await client.query(
        `INSERT INTO agency_contacts (agency_id, user_id) VALUES ($1, $2)`,
        [agencyId, userId]
      );
  
      await sendTempPasswordEmail(email, tempPassword);
      await client.query('COMMIT');
  
      console.log(`[Admin:${req.user.id}] Added contact ${email} to agency ${agencyId}`);
      return res.status(201).json({ success: true, message: 'Contact person added' });
  
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(err);
      return res.status(500).json({ success: false, message: 'Add contact failed', error: err.message });
    } finally {
      client.release();
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
  
  // Update to deleteAgency to include agency_contacts cleanup + logging
  exports.deleteAgency = async (req, res) => {
    const agencyId = req.params.id;
  
    const client = await db.connect();
    try {
      await client.query('BEGIN');
  
      await client.query('DELETE FROM agency_contacts WHERE agency_id = $1', [agencyId]);
      await client.query('DELETE FROM agencies WHERE id = $1', [agencyId]);
  
      await client.query(
        `INSERT INTO audit_logs (action_type, entity_type, entity_int_id, performed_by, details)
         VALUES ($1, $2, $3, $4, $5)`,
        ['DELETE', 'AGENCY', agencyId, req.user.id, `Deleted agency ${agencyId}`]
      );
      
      
      
      await client.query('COMMIT');
      
      console.log(`[Admin:${req.user.id}] Deleted agency ${agencyId}`);
      return res.status(200).json({ success: true, message: 'Agency and contacts deleted' });      
      
  
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(err);
      return res.status(500).json({ success: false, message: 'Deletion failed', error: err.message });
    } finally {
      client.release();
    }
  };  

// View agencies and contact persons
exports.getAgencies = async (req, res) => {
  try {
    const agencies = await db.query(`
      SELECT a.*, json_agg(
        json_build_object(
          'user_id', u.id,
          'full_name', u.full_name,
          'email', u.email,
          'phone_number', u.phone_number
        )
      ) AS contacts
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
      SELECT a.*, json_agg(
        json_build_object(
          'user_id', u.id,
          'full_name', u.full_name,
          'email', u.email,
          'phone_number', u.phone_number
        )
      ) AS contacts
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
exports.getAgencyReportSummaryById = async (req, res) => {
  const agencyId = req.params.id;

  try {
    const result = await db.query(`
      SELECT 
        a.id AS agency_id,
        a.name AS agency_name,
        COUNT(r.id) AS number_of_reports,
        MAX(r.date_submitted) AS last_report_date,
        (
          SELECT r2.status
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

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Agency not found' });
    }

    res.status(200).json({ success: true, summary: result.rows[0] });
  } catch (err) {
    console.error('Error fetching agency summary:', err);
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
};


// GET /agencies/:id/referred-reports
exports.getReferredReportsForAgency = async (req, res) => {
  const agencyId = req.params.id;

  try {
    const result = await db.query(
      `SELECT * FROM referrals
       WHERE agency_id = $1
       ORDER BY referral_date DESC`,
      [agencyId]
    );

    return res.status(200).json({
      success: true,
      reports: result.rows,
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

