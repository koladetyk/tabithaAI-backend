// middleware/roleChecks.js

module.exports = {
    // Only allow general admins or higher
    checkAdmin: (req, res, next) => {
      if (!req.user?.is_admin) {
        return res.status(403).json({ message: 'Admin access required' });
      }
      next();
    },
  
    // Only allow the master admin
    checkMasterAdmin: (req, res, next) => {
      if (!req.user?.is_master_admin) {
        return res.status(403).json({ message: 'Master admin access required' });
      }
      next();
    },
  
    // Only allow agency contact users
    checkAgencyUser: (req, res, next) => {
      if (!req.user?.is_agency_user) {
        return res.status(403).json({ message: 'Agency contact access required' });
      }
      next();
    }
  };
  