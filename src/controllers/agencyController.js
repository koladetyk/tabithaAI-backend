const db = require('../config/database');
const bcrypt = require('bcrypt');
const generatePassword = require('../utils/generatePassword');
const sendTempPasswordEmail = require('../utils/sendTempPasswordEmail'); // optional but recommended

// Admin adds agency and contacts
exports.addAgency = async (req, res) => {
  const { name, agency_notes, contacts } = req.body;

  if (!name || !contacts || !Array.isArray(contacts)) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const agencyResult = await client.query(
      `INSERT INTO agencies (name, agency_notes) VALUES ($1, $2) RETURNING id`,
      [name, agency_notes]
    );
    const agencyId = agencyResult.rows[0].id;

    for (const contact of contacts) {
      const { full_name, email, phone_number } = contact;

      const tempPassword = generatePassword();
      const hashedPassword = await bcrypt.hash(tempPassword, 10);

      const userResult = await client.query(
        `INSERT INTO users (full_name, email, phone_number, password, is_agency_user)
         VALUES ($1, $2, $3, $4, true) RETURNING id`,
        [full_name, email, phone_number, hashedPassword]
      );
      const userId = userResult.rows[0].id;

      await client.query(
        `INSERT INTO agency_contacts (agency_id, user_id) VALUES ($1, $2)`,
        [agencyId, userId]
      );

      try {
        await sendTempPasswordEmail(email, tempPassword);
      } catch (emailErr) {
        console.error(`Failed to send email to ${email}:`, emailErr.message);
        // You can optionally log this error to DB or alert an admin
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
  const agencyId = req.params.id;
  const { name, agency_notes } = req.body;

  try {
    await db.query(
      'UPDATE agencies SET name = $1, agency_notes = $2, day_added = CURRENT_DATE WHERE id = $3',
      [name, agency_notes, agencyId]
    );

    return res.status(200).json({ success: true, message: 'Agency updated successfully' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Update failed', error: err.message });
  }
};

// Admin deletes agency
exports.deleteAgency = async (req, res) => {
  const agencyId = req.params.id;

  try {
    await db.query('DELETE FROM agencies WHERE id = $1', [agencyId]);
    return res.status(200).json({ success: true, message: 'Agency deleted' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Deletion failed', error: err.message });
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
