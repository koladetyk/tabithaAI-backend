const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');

exports.addAgency = async (req, res) => {
  const { name, contact_email } = req.body;

  const password = uuidv4().slice(0, 8); // temp password
  const hashedPassword = await bcrypt.hash(password, 10);

  try {
    const agencyId = uuidv4();
    await db.query(
      'INSERT INTO users (id, email, password, is_agency, agency_name, is_admin) VALUES ($1, $2, $3, $4, $5, $6)',
      [agencyId, contact_email, hashedPassword, true, name, false]
    );
    res.status(201).json({ success: true, agencyId, password });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to add agency' });
  }
};

exports.updateAgency = async (req, res) => {
  const { id } = req.params;
  const { agency_name, email } = req.body;

  try {
    await db.query(
      'UPDATE users SET email = $1, agency_name = $2 WHERE id = $3 AND is_agency = true',
      [email, agency_name, id]
    );
    res.status(200).json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update agency' });
  }
};

exports.deleteAgency = async (req, res) => {
  const { id } = req.params;

  try {
    await db.query('DELETE FROM users WHERE id = $1 AND is_agency = true', [id]);
    res.status(200).json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to delete agency' });
  }
};
