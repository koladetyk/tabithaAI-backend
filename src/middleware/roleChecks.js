function isAdmin(req, res, next) {
    if (req.user && req.user.is_admin) {
      return next();
    }
    return res.status(403).json({ success: false, message: 'Admin access required' });
  }
  
  function isMasterAdmin(req, res, next) {
    if (req.user && req.user.is_master_admin) {
      return next();
    }
    return res.status(403).json({ success: false, message: 'Master admin access required' });
  }
  
  function isAgencyUser(req, res, next) {
    if (req.user && req.user.is_agency_user) {
      return next();
    }
    return res.status(403).json({ success: false, message: 'Agency user access required' });
  }
  
  module.exports = {
    isAdmin,
    isMasterAdmin,
    isAgencyUser
  };
  