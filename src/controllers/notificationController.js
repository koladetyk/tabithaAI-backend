// src/controllers/notificationController.js
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');

class NotificationController {
  // Get all notifications for current user
  async getUserNotifications(req, res) {
    try {
      const userId = req.user.id;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const offset = (page - 1) * limit;
      
      // Get paginated notifications for user
      const notifications = await db.query(
        `SELECT * FROM notifications
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
      );
      
      // Get total count for pagination
      const countResult = await db.query(
        'SELECT COUNT(*) FROM notifications WHERE user_id = $1',
        [userId]
      );
      
      const totalCount = parseInt(countResult.rows[0].count);
      
      return res.status(200).json({
        success: true,
        count: notifications.rows.length,
        total: totalCount,
        pages: Math.ceil(totalCount / limit),
        currentPage: page,
        data: notifications.rows
      });
    } catch (error) {
      console.error('Error fetching notifications:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error retrieving notifications',
        error: error.message
      });
    }
  }
  
  // Get unread notification count
  async getUnreadCount(req, res) {
    try {
      const userId = req.user.id;
      
      const result = await db.query(
        'SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = false',
        [userId]
      );
      
      return res.status(200).json({
        success: true,
        unreadCount: parseInt(result.rows[0].count)
      });
    } catch (error) {
      console.error('Error fetching unread count:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error retrieving unread count',
        error: error.message
      });
    }
  }
  
  // Mark notification as read
  async markAsRead(req, res) {
    try {
      const notificationId = req.params.id;
      const userId = req.user.id;
      
      // Verify notification exists and belongs to user
      const notification = await db.query(
        'SELECT * FROM notifications WHERE id = $1 AND user_id = $2',
        [notificationId, userId]
      );
      
      if (notification.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Notification not found or does not belong to user'
        });
      }
      
      // Update notification
      const updatedNotification = await db.query(
        `UPDATE notifications 
         SET is_read = true 
         WHERE id = $1 
         RETURNING *`,
        [notificationId]
      );
      
      return res.status(200).json({
        success: true,
        data: updatedNotification.rows[0],
        message: 'Notification marked as read'
      });
    } catch (error) {
      console.error('Error marking notification as read:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error updating notification',
        error: error.message
      });
    }
  }
  
  // Mark all notifications as read
  async markAllAsRead(req, res) {
    try {
      const userId = req.user.id;
      
      const result = await db.query(
        `UPDATE notifications 
         SET is_read = true 
         WHERE user_id = $1 AND is_read = false 
         RETURNING *`,
        [userId]
      );
      
      return res.status(200).json({
        success: true,
        count: result.rows.length,
        message: `${result.rows.length} notifications marked as read`
      });
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error updating notifications',
        error: error.message
      });
    }
  }
  
  // Delete notification
  async deleteNotification(req, res) {
    try {
      const notificationId = req.params.id;
      const userId = req.user.id;
      
      // Verify notification exists and belongs to user
      const notification = await db.query(
        'SELECT * FROM notifications WHERE id = $1 AND user_id = $2',
        [notificationId, userId]
      );
      
      if (notification.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Notification not found or does not belong to user'
        });
      }
      
      // Delete notification
      await db.query(
        'DELETE FROM notifications WHERE id = $1',
        [notificationId]
      );
      
      return res.status(200).json({
        success: true,
        message: 'Notification deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting notification:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error deleting notification',
        error: error.message
      });
    }
  }
  
  // Create a new notification (internal use by other controllers)
  async createNotification(userId, title, message, notificationType, relatedEntityType = null, relatedEntityId = null) {
    try {
      const notificationId = uuidv4();
      
      const notification = await db.query(
        `INSERT INTO notifications (
          id, 
          user_id, 
          title,
          message, 
          notification_type, 
          related_entity_type, 
          related_entity_id, 
          is_read, 
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, false, CURRENT_TIMESTAMP) 
        RETURNING *`,
        [
          notificationId, 
          userId, 
          title,
          message, 
          notificationType, 
          relatedEntityType, 
          relatedEntityId
        ]
      );
      
      return notification.rows[0];
    } catch (error) {
      console.error('Error creating notification:', error);
      return null;
    }
  }
}

module.exports = new NotificationController();