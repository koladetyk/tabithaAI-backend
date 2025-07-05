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
  