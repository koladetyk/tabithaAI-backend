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

// NEW: Get all admins with pagination and filtering
exports.getAllAdmins = async (req, res) => {
  try {
    const { page = 1, limit = 10, search, status = 'active' } = req.query;
    const offset = (page - 1) * limit;
    
    // Build query for admins
    let query = `SELECT 
      id, 
      username, 
      email, 
      phone_number, 
      full_name, 
      is_admin, 
      is_master_admin,
      profile_picture,
      created_at,
      updated_at,
      last_login
    FROM users 
    WHERE is_admin = true`;
    
    let countQuery = 'SELECT COUNT(*) FROM users WHERE is_admin = true';
    let queryParams = [];
    let conditions = [];
    
    // Add search functionality
    if (search) {
      const searchTerm = `%${search.trim()}%`;
      conditions.push(
        '(username ILIKE $' + (queryParams.length + 1) + 
        ' OR email ILIKE $' + (queryParams.length + 2) + 
        ' OR full_name ILIKE $' + (queryParams.length + 3) + ')'
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
    query += ' ORDER BY created_at DESC LIMIT $' + (queryParams.length + 1) + ' OFFSET $' + (queryParams.length + 2);
    const paginationParams = [...queryParams, limit, offset];
    
    // Execute queries
    const [admins, totalCount] = await Promise.all([
      db.query(query, paginationParams),
      db.query(countQuery, queryParams)
    ]);
    
    // Get agency info for admins who are also agency users
    const adminIds = admins.rows.map(admin => admin.id);
    let adminsWithAgencyInfo = admins.rows;
    
    if (adminIds.length > 0) {
      const agencyInfoQuery = `
        SELECT 
          ac.user_id,
          a.id as agency_id,
          a.name as agency_name,
          a.status as agency_status
        FROM agency_contacts ac
        JOIN agencies a ON ac.agency_id = a.id
        WHERE ac.user_id = ANY($1)
      `;
      
      const agencyInfoResult = await db.query(agencyInfoQuery, [adminIds]);
      
      // Map agency info to admins
      const agencyInfoMap = {};
      agencyInfoResult.rows.forEach(row => {
        agencyInfoMap[row.user_id] = {
          agency_id: row.agency_id,
          agency_name: row.agency_name,
          agency_status: row.agency_status
        };
      });
      
      adminsWithAgencyInfo = admins.rows.map(admin => ({
        ...admin,
        agency_info: agencyInfoMap[admin.id] || null
      }));
    }
    
    return res.status(200).json({
      success: true,
      data: adminsWithAgencyInfo,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(totalCount.rows[0].count),
        pages: Math.ceil(totalCount.rows[0].count / limit)
      },
      filters: {
        search: search || null,
        status: status
      }
    });
    
  } catch (error) {
    console.error('Error fetching admins:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error fetching admins',
      error: error.message
    });
  }
};


