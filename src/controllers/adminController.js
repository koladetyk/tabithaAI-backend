exports.getAuditLogs = async (req, res) => {
    try {
      const logs = await db.query(`
        SELECT al.*, u.username AS admin_username
        FROM audit_logs al
        LEFT JOIN users u ON al.performed_by = u.id
        ORDER BY al.timestamp DESC
      `);
  
      return res.status(200).json({ success: true, logs: logs.rows });
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Failed to fetch audit logs', error: err.message });
    }
  };
  
// Promote user to admin
exports.promoteToAdmin = async (req, res) => {
  const targetUserId = parseInt(req.params.id);

  if (!req.user.is_admin) {
    return res.status(403).json({ message: 'Only admins can promote users' });
  }

  try {
    await db.query('UPDATE users SET is_admin = true WHERE id = $1', [targetUserId]);

    await db.query(
      `INSERT INTO audit_logs (action_type, entity_type, entity_int_id, performed_by, details)
       VALUES ($1, $2, $3, $4, $5)`,
      ['PROMOTE', 'USER', targetUserId, req.user.id, `Promoted user ${targetUserId} to admin`]
    );

    return res.status(200).json({ message: 'User promoted to admin' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Failed to promote user' });
  }
};

// Demote admin (only by master admin)
exports.demoteAdmin = async (req, res) => {
  const targetUserId = parseInt(req.params.id);

  if (!req.user.is_master_admin) {
    return res.status(403).json({ message: 'Only the master admin can demote admins' });
  }

  try {
    if (req.user.id === targetUserId) {
      return res.status(400).json({ message: 'Master admin cannot demote themselves' });
    }

    await db.query('UPDATE users SET is_admin = false WHERE id = $1', [targetUserId]);

    await db.query(
      `INSERT INTO audit_logs (action_type, entity_type, entity_int_id, performed_by, details)
       VALUES ($1, $2, $3, $4, $5)`,
      ['DEMOTE', 'USER', targetUserId, req.user.id, `Demoted admin ${targetUserId} to regular user`]
    );

    return res.status(200).json({ message: 'Admin demoted to regular user' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Failed to demote admin' });
  }
};
