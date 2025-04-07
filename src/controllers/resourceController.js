// src/controllers/resourceController.js
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const path = require('path');
const fs = require('fs');
const storageService = require('../services/storageService');

class ResourceController {
  // Get all resources with filtering options
  async getAllResources(req, res) {
    try {
      // Extract query parameters
      const { category, language, content_type, search, page = 1, limit = 20 } = req.query;
      
      // Build the query
      let query = 'SELECT * FROM resources WHERE is_published = true';
      const queryParams = [];
      let paramIndex = 1;
      
      if (category) {
        query += ` AND category = $${paramIndex}`;
        queryParams.push(category);
        paramIndex++;
      }
      
      if (language) {
        query += ` AND language = $${paramIndex}`;
        queryParams.push(language);
        paramIndex++;
      }
      
      if (content_type) {
        query += ` AND content_type = $${paramIndex}`;
        queryParams.push(content_type);
        paramIndex++;
      }
      
      if (search) {
        query += ` AND (title ILIKE $${paramIndex} OR description ILIKE $${paramIndex})`;
        queryParams.push(`%${search}%`);
        paramIndex++;
      }
      
      // Add pagination
      const offset = (page - 1) * limit;
      query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      queryParams.push(limit, offset);
      
      // Execute the query
      const resources = await db.query(query, queryParams);
      
      // Get total count for pagination
      let countQuery = 'SELECT COUNT(*) FROM resources WHERE is_published = true';
      let countParams = [];
      paramIndex = 1;
      
      if (category) {
        countQuery += ` AND category = $${paramIndex}`;
        countParams.push(category);
        paramIndex++;
      }
      
      if (language) {
        countQuery += ` AND language = $${paramIndex}`;
        countParams.push(language);
        paramIndex++;
      }
      
      if (content_type) {
        countQuery += ` AND content_type = $${paramIndex}`;
        countParams.push(content_type);
        paramIndex++;
      }
      
      if (search) {
        countQuery += ` AND (title ILIKE $${paramIndex} OR description ILIKE $${paramIndex})`;
        countParams.push(`%${search}%`);
      }
      
      const countResult = await db.query(countQuery, countParams);
      const totalCount = parseInt(countResult.rows[0].count);
      
      return res.status(200).json({
        success: true,
        count: resources.rows.length,
        total: totalCount,
        pages: Math.ceil(totalCount / limit),
        page: parseInt(page),
        data: resources.rows
      });
    } catch (error) {
      console.error('Error fetching resources:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error fetching resources',
        error: error.message
      });
    }
  }

  // Get resource by ID
  async getResourceById(req, res) {
    try {
      const resourceId = req.params.id;
      
      // Get the resource
      const resource = await db.query(
        'SELECT * FROM resources WHERE id = $1',
        [resourceId]
      );
      
      if (resource.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Resource not found'
        });
      }
      
      // Check if the resource is published or user is admin
      if (!resource.rows[0].is_published && !req.user?.is_admin) {
        return res.status(403).json({
          success: false,
          message: 'This resource is not published'
        });
      }
      
      return res.status(200).json({
        success: true,
        data: resource.rows[0]
      });
    } catch (error) {
      console.error('Error fetching resource:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error fetching resource',
        error: error.message
      });
    }
  }

  // Get resource file
  async getResourceFile(req, res) {
    try {
      const resourceId = req.params.id;
      
      // Get the resource
      const resource = await db.query(
        'SELECT * FROM resources WHERE id = $1',
        [resourceId]
      );
      
      if (resource.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Resource not found'
        });
      }
      
      // Check if the resource is published or user is admin
      if (!resource.rows[0].is_published && !req.user?.is_admin) {
        return res.status(403).json({
          success: false,
          message: 'This resource is not published'
        });
      }
      
      // Check if the resource has a file path
      if (!resource.rows[0].file_path) {
        return res.status(404).json({
          success: false,
          message: 'This resource does not have an associated file'
        });
      }
      
      // Generate signed URL if it's a cloud storage path
      if (resource.rows[0].file_path.startsWith('gs://')) {
        try {
          const signedUrl = await storageService.getSignedUrl(resource.rows[0].file_path);
          
          return res.redirect(signedUrl);
        } catch (error) {
          console.error('Error generating signed URL:', error);
          return res.status(500).json({
            success: false,
            message: 'Error accessing resource file',
            error: error.message
          });
        }
      } else {
        // For local files
        const filePath = resource.rows[0].file_path;
        
        // Check if file exists
        if (!fs.existsSync(filePath)) {
          return res.status(404).json({
            success: false,
            message: 'Resource file not found'
          });
        }
        
        return res.sendFile(path.resolve(filePath));
      }
    } catch (error) {
      console.error('Error accessing resource file:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error accessing resource file',
        error: error.message
      });
    }
  }

  // Create new resource (admin only)
  async createResource(req, res) {
    try {
      const {
        title,
        description,
        content_type,
        category,
        language,
        tags,
        is_published
      } = req.body;
      
      // Validate required fields
      if (!title || !content_type || !category) {
        return res.status(400).json({
          success: false,
          message: 'Title, content type, and category are required'
        });
      }
      
      // Only admins can create resources
      if (!req.user.is_admin) {
        return res.status(403).json({
          success: false,
          message: 'Only administrators can create resources'
        });
      }
      
      // Generate new UUID for resource
      const resourceId = uuidv4();
      
      // Handle file upload if present
      let filePath = null;
      
      if (req.file) {
        // Upload file to cloud storage
        filePath = await storageService.uploadFile(
          req.file,
          'resources',
          resourceId,
          content_type
        );
      }
      
      // Process tags array
      const processedTags = tags ? 
        (Array.isArray(tags) ? tags : JSON.parse(tags)) : 
        [];
      
      // Create new resource
      const newResource = await db.query(
        `INSERT INTO resources (
          id,
          title,
          description,
          content_type,
          category,
          language,
          file_path,
          tags,
          is_published,
          created_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING *`,
        [
          resourceId,
          title,
          description || null,
          content_type,
          category,
          language || 'en',
          filePath,
          processedTags,
          is_published !== undefined ? is_published : true
        ]
      );
      
      return res.status(201).json({
        success: true,
        data: newResource.rows[0],
        message: 'Resource created successfully'
      });
    } catch (error) {
      console.error('Error creating resource:', error);
      
      // Delete uploaded file if there was an error
      if (req.file && req.file.path) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (unlinkError) {
          console.error('Error deleting file:', unlinkError);
        }
      }
      
      return res.status(500).json({
        success: false,
        message: 'Server error creating resource',
        error: error.message
      });
    }
  }

  // Update resource (admin only)
  async updateResource(req, res) {
    try {
      const resourceId = req.params.id;
      const {
        title,
        description,
        content_type,
        category,
        language,
        tags,
        is_published
      } = req.body;
      
      // Only admins can update resources
      if (!req.user.is_admin) {
        return res.status(403).json({
          success: false,
          message: 'Only administrators can update resources'
        });
      }
      
      // Check if resource exists
      const resource = await db.query(
        'SELECT * FROM resources WHERE id = $1',
        [resourceId]
      );
      
      if (resource.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Resource not found'
        });
      }
      
      // Handle file upload if present
      let filePath = resource.rows[0].file_path;
      
      if (req.file) {
        // If there's an existing file, delete it
        if (filePath && filePath.startsWith('gs://')) {
          try {
            await storageService.deleteFile(filePath);
          } catch (error) {
            console.error('Error deleting previous file:', error);
            // Continue with update even if file deletion fails
          }
        }
        
        // Upload new file
        filePath = await storageService.uploadFile(
          req.file,
          'resources',
          resourceId,
          content_type || resource.rows[0].content_type
        );
      }
      
      // Process tags array
      let processedTags = resource.rows[0].tags;
      if (tags !== undefined) {
        processedTags = Array.isArray(tags) ? tags : JSON.parse(tags);
      }
      
      // Update resource
      const updatedResource = await db.query(
        `UPDATE resources SET
          title = COALESCE($1, title),
          description = COALESCE($2, description),
          content_type = COALESCE($3, content_type),
          category = COALESCE($4, category),
          language = COALESCE($5, language),
          file_path = COALESCE($6, file_path),
          tags = $7,
          is_published = COALESCE($8, is_published),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $9
        RETURNING *`,
        [
          title,
          description,
          content_type,
          category,
          language,
          filePath,
          processedTags,
          is_published,
          resourceId
        ]
      );
      
      return res.status(200).json({
        success: true,
        data: updatedResource.rows[0],
        message: 'Resource updated successfully'
      });
    } catch (error) {
      console.error('Error updating resource:', error);
      
      // Delete uploaded file if there was an error
      if (req.file && req.file.path) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (unlinkError) {
          console.error('Error deleting file:', unlinkError);
        }
      }
      
      return res.status(500).json({
        success: false,
        message: 'Server error updating resource',
        error: error.message
      });
    }
  }

  // Delete resource (admin only)
  async deleteResource(req, res) {
    try {
      const resourceId = req.params.id;
      
      // Only admins can delete resources
      if (!req.user.is_admin) {
        return res.status(403).json({
          success: false,
          message: 'Only administrators can delete resources'
        });
      }
      
      // Check if resource exists
      const resource = await db.query(
        'SELECT * FROM resources WHERE id = $1',
        [resourceId]
      );
      
      if (resource.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Resource not found'
        });
      }
      
      // If there's a file associated with the resource, delete it
      if (resource.rows[0].file_path && resource.rows[0].file_path.startsWith('gs://')) {
        try {
          await storageService.deleteFile(resource.rows[0].file_path);
        } catch (error) {
          console.error('Error deleting file:', error);
          // Continue with deletion even if file deletion fails
        }
      }
      
      // Delete the resource
      await db.query('DELETE FROM resources WHERE id = $1', [resourceId]);
      
      return res.status(200).json({
        success: true,
        message: 'Resource deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting resource:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error deleting resource',
        error: error.message
      });
    }
  }
}

module.exports = new ResourceController();