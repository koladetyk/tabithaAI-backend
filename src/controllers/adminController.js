const db = require('../config/database');

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
  const targetUserId = req.params.id;

  if (!req.user.is_admin) {
    return res.status(403).json({ message: 'Only admins can promote users' });
  }

  try {
    const { rows } = await db.query('SELECT is_admin FROM users WHERE id = $1', [targetUserId]);

    if (rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (rows[0].is_admin) {
      return res.status(400).json({ message: 'User is already an admin' });
    }

    await db.query('UPDATE users SET is_admin = true WHERE id = $1', [targetUserId]);

    await db.query(
      `INSERT INTO audit_logs (action_type, entity_type, entity_uuid, performed_by, details)
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
  const targetUserId = req.params.id;

  if (!req.user.is_master_admin) {
    return res.status(403).json({ message: 'Only the master admin can demote admins' });
  }

  if (req.user.id === targetUserId) {
    return res.status(400).json({ message: 'Master admin cannot demote themselves' });
  }

  try {
    const { rows } = await db.query('SELECT is_admin FROM users WHERE id = $1', [targetUserId]);

    if (rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (!rows[0].is_admin) {
      return res.status(400).json({ message: 'User is not an admin' });
    }

    await db.query('UPDATE users SET is_admin = false WHERE id = $1', [targetUserId]);

    await db.query(
      `INSERT INTO audit_logs (action_type, entity_type, entity_uuid, performed_by, details)
       VALUES ($1, $2, $3, $4, $5)`,
      ['DEMOTE', 'USER', targetUserId, req.user.id, `Demoted admin ${targetUserId} to regular user`]
    );

    return res.status(200).json({ message: 'Admin demoted to regular user' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Failed to demote admin' });
  }
};

exports.getDashboardStats = async (req, res) => {
  try {
    const [userResult, reportResult, pendingResult, completedResult] = await Promise.all([
      db.query('SELECT COUNT(*) FROM users'),
      db.query('SELECT COUNT(*) FROM reports'),
      db.query("SELECT COUNT(*) FROM reports WHERE status = 'pending'"),
      db.query("SELECT COUNT(*) FROM reports WHERE status = 'completed'")
    ]);

    return res.status(200).json({
      totalUsers: parseInt(userResult.rows[0].count, 10),
      totalReports: parseInt(reportResult.rows[0].count, 10),
      pendingReports: parseInt(pendingResult.rows[0].count, 10),
      completedReports: parseInt(completedResult.rows[0].count, 10)
    });
  } catch (err) {
    console.error('Dashboard stats error:', err);
    return res.status(500).json({ message: 'Failed to fetch dashboard stats' });
  }
};


