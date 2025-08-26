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
  
// Promote user to admin by email
exports.promoteToAdmin = async (req, res) => {
  const targetEmail = req.params.email || req.body.email;
 
  if (!req.user.is_admin) {
    return res.status(403).json({ message: 'Only admins can promote users' });
  }

  if (!targetEmail) {
    return res.status(400).json({ message: 'Email is required' });
  }
 
  try {
    const { rows } = await db.query('SELECT id, email, is_admin FROM users WHERE email = $1', [targetEmail]);
     
    if (rows.length === 0) {
      return res.status(404).json({ message: 'User not found with this email' });
    }
     
    if (rows[0].is_admin) {
      return res.status(400).json({ message: 'User is already an admin' });
    }

    const targetUserId = rows[0].id;
     
    await db.query('UPDATE users SET is_admin = true WHERE id = $1', [targetUserId]);
     
    await db.query(
      `INSERT INTO audit_logs (action_type, entity_type, entity_uuid, performed_by, details)
       VALUES ($1, $2, $3, $4, $5)`,
      ['PROMOTE', 'USER', targetUserId, req.user.id, `Promoted user ${targetEmail} to admin`]
    );
     
    return res.status(200).json({ 
      message: 'User promoted to admin',
      promotedUser: {
        id: targetUserId,
        email: targetEmail
      }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Failed to promote user' });
  }
};

// Demote admin by email (only by master admin)
exports.demoteAdmin = async (req, res) => {
  const targetEmail = req.params.email || req.body.email;
 
  if (!req.user.is_master_admin) {
    return res.status(403).json({ message: 'Only the master admin can demote admins' });
  }

  if (!targetEmail) {
    return res.status(400).json({ message: 'Email is required' });
  }
 
  if (req.user.email === targetEmail) {
    return res.status(400).json({ message: 'Master admin cannot demote themselves' });
  }
 
  try {
    const { rows } = await db.query('SELECT id, email, is_admin FROM users WHERE email = $1', [targetEmail]);
     
    if (rows.length === 0) {
      return res.status(404).json({ message: 'User not found with this email' });
    }
     
    if (!rows[0].is_admin) {
      return res.status(400).json({ message: 'User is not an admin' });
    }

    const targetUserId = rows[0].id;
     
    await db.query('UPDATE users SET is_admin = false WHERE id = $1', [targetUserId]);
     
    await db.query(
      `INSERT INTO audit_logs (action_type, entity_type, entity_uuid, performed_by, details)
       VALUES ($1, $2, $3, $4, $5)`,
      ['DEMOTE', 'USER', targetUserId, req.user.id, `Demoted admin ${targetEmail} to regular user`]
    );
     
    return res.status(200).json({ 
      message: 'Admin demoted to regular user',
      demotedUser: {
        id: targetUserId,
        email: targetEmail
      }
    });
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
      db.query("SELECT COUNT(*) FROM reports WHERE status IN ('under_review', 'processing')"),
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


