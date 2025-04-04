// src/services/notificationService.js
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const socketService = require('./socketService');

class NotificationService {
  // Create and send a notification
  async createAndSendNotification(userId, title, message, notificationType, relatedEntityType = null, relatedEntityId = null) {
    try {
      if (!userId) {
        console.warn('Attempted to send notification to undefined user');
        return null;
      }
      
      const notificationId = uuidv4();
      
      // Create notification in database
      const result = await db.query(
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
      
      const notification = result.rows[0];
      
      // Send real-time notification through Socket.io
      try {
        socketService.sendNotification(userId, notification);
      } catch (socketError) {
        console.error('Error sending socket notification:', socketError);
        // Continue even if socket fails - notification is still in DB
      }
      
      console.log(`Notification created for user ${userId}: ${title}`);
      
      return notification;
    } catch (error) {
      console.error('Error creating notification:', error);
      return null;
    }
  }
  
  // Send notification to multiple users
  async sendToMultipleUsers(userIds, title, message, notificationType, relatedEntityType = null, relatedEntityId = null) {
    const notifications = [];
    
    for (const userId of userIds) {
      try {
        const notification = await this.createAndSendNotification(
          userId, 
          title,
          message, 
          notificationType, 
          relatedEntityType, 
          relatedEntityId
        );
        
        if (notification) {
          notifications.push(notification);
        }
      } catch (error) {
        console.error(`Error sending notification to user ${userId}:`, error);
      }
    }
    
    return notifications;
  }
  
  // Report status update notification
  async sendReportStatusNotification(userId, reportId, newStatus) {
    const statusMessages = {
      'submitted': 'Your report has been received',
      'under_review': 'Your report is now under review',
      'in_progress': 'Work has begun on your report',
      'resolved': 'Your report has been marked as resolved',
      'closed': 'Your report has been closed',
      'archived': 'Your report has been archived'
    };
    
    const title = 'Report Status Update';
    const message = statusMessages[newStatus] || `Your report status has been updated to: ${newStatus}`;
    
    return this.createAndSendNotification(
      userId,
      title,
      message,
      'report_status',
      'report',
      reportId
    );
  }
  // Evidence analyzed notification
  async sendEvidenceAnalyzedNotification(userId, reportId, evidenceId) {
    return this.createAndSendNotification(
      userId,
      'Evidence Analyzed',
      'Your evidence has been analyzed and the report has been updated',
      'evidence_analyzed',
      'evidence',
      evidenceId
    );
  }
  
  // Get notifications for a user
  async getUserNotifications(userId, page = 1, limit = 20) {
    try {
      const offset = (page - 1) * limit;
      
      const query = `
        SELECT * FROM notifications
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3
      `;
      
      const countQuery = `
        SELECT COUNT(*) FROM notifications
        WHERE user_id = $1
      `;
      
      const result = await db.query(query, [userId, limit, offset]);
      const countResult = await db.query(countQuery, [userId]);
      
      return {
        notifications: result.rows,
        total: parseInt(countResult.rows[0].count),
        page,
        limit,
        totalPages: Math.ceil(parseInt(countResult.rows[0].count) / limit)
      };
    } catch (error) {
      console.error('Error getting user notifications:', error);
      return {
        notifications: [],
        total: 0,
        page,
        limit,
        totalPages: 0,
        error: error.message
      };
    }
  }
  
  // Mark notification as read
  async markAsRead(notificationId, userId) {
    try {
      const query = `
        UPDATE notifications
        SET is_read = true
        WHERE id = $1 AND user_id = $2
        RETURNING *
      `;
      
      const result = await db.query(query, [notificationId, userId]);
      
      if (result.rows.length === 0) {
        throw new Error('Notification not found or not owned by user');
      }
      
      return result.rows[0];
    } catch (error) {
      console.error('Error marking notification as read:', error);
      return null;
    }
  }
  
  // Mark all notifications as read for a user
  async markAllAsRead(userId) {
    try {
      const query = `
        UPDATE notifications
        SET is_read = true
        WHERE user_id = $1 AND is_read = false
        RETURNING *
      `;
      
      const result = await db.query(query, [userId]);
      
      return result.rows;
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
      return [];
    }
  }
  
  // Delete old notifications (cleanup)
  async deleteOldNotifications(days = 30) {
    try {
      const query = `
        DELETE FROM notifications
        WHERE created_at < NOW() - INTERVAL '${days} days'
        RETURNING id
      `;
      
      const result = await db.query(query);
      
      return {
        success: true,
        count: result.rows.length,
        message: `${result.rows.length} old notifications deleted`
      };
    } catch (error) {
      console.error('Error deleting old notifications:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = new NotificationService();