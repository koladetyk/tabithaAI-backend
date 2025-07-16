// src/controllers/referralController.js
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');

class ReferralController {
  // Get all referrals for a report
  async getReferralsForReport(req, res) {
    try {
      const reportId = req.params.reportId;
  
      const report = await db.query('SELECT * FROM reports WHERE id = $1', [reportId]);
      if (report.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Report not found' });
      }
  
      if (!req.user.is_admin && req.user.id !== report.rows[0].user_id) {
        return res.status(403).json({ success: false, message: 'You do not have permission to view referrals for this report' });
      }
  
      const referrals = await db.query(
        `SELECT r.*, ag.name as agency_name
         FROM referrals r
         JOIN agencies ag ON r.agency_id = ag.id
         WHERE r.report_id = $1
         ORDER BY r.created_at DESC`,
        [reportId]
      );
  
      return res.status(200).json({
        success: true,
        count: referrals.rows.length,
        data: referrals.rows
      });
    } catch (error) {
      console.error('Error fetching referrals:', error);
      return res.status(500).json({ success: false, message: 'Server error fetching referrals', error: error.message });
    }
  }
  

  // Get referral by ID
  async getReferralById(req, res) {
    try {
      const referralId = req.params.id;
  
      const referral = await db.query(
        `SELECT r.*, 
          ag.name as agency_name,
          rep.user_id as report_user_id
         FROM referrals r
         JOIN agencies ag ON r.agency_id = ag.id
         JOIN reports rep ON r.report_id = rep.id
         WHERE r.id = $1`,
        [referralId]
      );
  
      if (referral.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Referral not found' });
      }
  
      if (!req.user.is_admin && req.user.id !== referral.rows[0].report_user_id) {
        return res.status(403).json({ success: false, message: 'You do not have permission to view this referral' });
      }
  
      const { report_user_id, ...referralData } = referral.rows[0];
  
      return res.status(200).json({ success: true, data: referralData });
    } catch (error) {
      console.error('Error fetching referral:', error);
      return res.status(500).json({ success: false, message: 'Server error fetching referral', error: error.message });
    }
  }  

  // Create a new referral
  async createReferral(req, res) {
    try {
      const { report_id, agency_id, notes } = req.body;
  
      if (!report_id || !agency_id) {
        return res.status(400).json({ success: false, message: 'Report ID and Agency ID are required' });
      }
  
      const report = await db.query('SELECT * FROM reports WHERE id = $1', [report_id]);
      if (report.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Report not found' });
      }
  
      const agency = await db.query('SELECT * FROM agencies WHERE id = $1', [agency_id]);
      if (agency.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Agency not found' });
      }
  
      if (!req.user.is_admin && req.user.id !== report.rows[0].user_id) {
        return res.status(403).json({ success: false, message: 'You do not have permission to create referrals for this report' });
      }
  
      const referralId = uuidv4();
  
      const newReferral = await db.query(
        `INSERT INTO referrals (
          id, report_id, agency_id, referral_date, referral_status, notes, created_at, updated_at
        ) VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         RETURNING *`,
        [referralId, report_id, agency_id, 'pending', notes || null]
      );
  
      const agencyName = agency.rows[0].name;
  
      if (report.rows[0].user_id) {
        const notificationController = require('./notificationController');
        await notificationController.createNotification(
          report.rows[0].user_id,
          'New Referral',
          `You've been referred to ${agencyName} for support`,
          'referral_created',
          'referral',
          referralId
        );
      }
  
      return res.status(201).json({
        success: true,
        data: newReferral.rows[0],
        message: 'Referral created successfully'
      });
    } catch (error) {
      console.error('Error creating referral:', error);
      return res.status(500).json({ success: false, message: 'Server error creating referral', error: error.message });
    }
  }  

  // Update referral status
  async updateReferralStatus(req, res) {
    try {
      const referralId = req.params.id;
      const { status, notes } = req.body;
  
      if (!status) {
        return res.status(400).json({ success: false, message: 'Status is required' });
      }
  
      const validStatuses = ['pending', 'accepted', 'declined', 'completed', 'canceled'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
        });
      }
  
      const referral = await db.query(
        `SELECT r.*, rep.user_id as report_user_id
         FROM referrals r
         JOIN reports rep ON r.report_id = rep.id
         WHERE r.id = $1`,
        [referralId]
      );
  
      if (referral.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Referral not found' });
      }
  
      if (!req.user.is_admin && req.user.id !== referral.rows[0].report_user_id) {
        return res.status(403).json({ success: false, message: 'You do not have permission to update this referral' });
      }
  
      const updatedReferral = await db.query(
        `UPDATE referrals
         SET referral_status = $1,
             notes = CASE WHEN $2::text IS NOT NULL THEN $2 ELSE notes END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $3
         RETURNING *`,
        [status, notes, referralId]
      );
  
      if (referral.rows[0].report_user_id) {
        const notificationController = require('./notificationController');
        const agency = await db.query('SELECT name FROM agencies WHERE id = $1', [referral.rows[0].agency_id]);
        const agencyName = agency.rows[0].name;
  
        await notificationController.createNotification(
          referral.rows[0].report_user_id,
          'Referral Status Updated',
          `Your referral to ${agencyName} is now ${status}`,
          'referral_updated',
          'referral',
          referralId
        );
      }
  
      return res.status(200).json({
        success: true,
        data: updatedReferral.rows[0],
        message: `Referral status updated to "${status}" successfully`
      });
    } catch (error) {
      console.error('Error updating referral:', error);
      return res.status(500).json({ success: false, message: 'Server error updating referral', error: error.message });
    }
  }
  

  // Delete referral
  async deleteReferral(req, res) {
    try {
      const referralId = req.params.id;
      
      // Get the referral to check permissions
      const referral = await db.query(
        `SELECT r.*, rep.user_id as report_user_id
         FROM referrals r
         JOIN reports rep ON r.report_id = rep.id
         WHERE r.id = $1`,
        [referralId]
      );
      
      if (referral.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Referral not found'
        });
      }
      
      // Only admins can delete referrals
      if (!req.user.is_admin) {
        return res.status(403).json({
          success: false,
          message: 'Only administrators can delete referrals'
        });
      }
      
      // Delete the referral
      await db.query('DELETE FROM referrals WHERE id = $1', [referralId]);
      
      return res.status(200).json({
        success: true,
        message: 'Referral deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting referral:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error deleting referral',
        error: error.message
      });
    }
  }
}

module.exports = new ReferralController();