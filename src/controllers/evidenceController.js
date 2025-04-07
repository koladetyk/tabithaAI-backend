// src/controllers/evidenceController.js
const { v4: uuidv4 } = require('uuid');
const fs = require('fs'); 
const db = require('../config/database');
const storageService = require('../services/storageService');

class EvidenceController {
  // In evidenceController.js
  // Add evidence to a report - modified to handle multiple files
  async addEvidence(req, res) {
    try {
      const reportId = req.params.reportId;
      
      // Check if report exists
      const report = await db.query('SELECT * FROM reports WHERE id = $1', [reportId]);
      
      if (report.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Report not found'
        });
      }
      
      // Check if user has permission to add evidence to this report
      if (!req.user.is_admin && req.user.id !== report.rows[0].user_id) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to add evidence to this report'
        });
      }
      
      // Handle single file or multiple files
      const files = req.files || [req.file];
      
      if (!files || files.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No files uploaded'
        });
      }
      
      const createdEvidence = [];
      
      // Process each file
      for (const file of files) {
        // Generate new UUID for evidence
        const evidenceId = uuidv4();
        
        // Determine evidence type based on file mime type
        let evidenceType = 'document';
        if (file.mimetype.startsWith('image/')) {
          evidenceType = 'image';
        } else if (file.mimetype.startsWith('audio/')) {
          evidenceType = 'audio';
        } else if (file.mimetype.startsWith('video/')) {
          evidenceType = 'video';
        }
        
        // Upload file to Google Cloud Storage
        const fileUrl = await storageService.uploadFile(
          file, 
          req.user.id, 
          reportId, 
          evidenceType
        );
        
        // Create the evidence record
        const newEvidence = await db.query(
          `INSERT INTO evidence (
            id,
            report_id,
            evidence_type,
            file_path,
            file_url,
            description,
            submitted_date
          ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP) RETURNING *`,
          [
            evidenceId,
            reportId,
            evidenceType,
            file.originalname, // Store original filename for reference
            fileUrl, // Store the cloud storage URL
            req.body.description || null
          ]
        );
        
        createdEvidence.push(newEvidence.rows[0]);
        
        // Record AI interaction if AI analysis was requested
        if (req.body.analyzeWithAI === 'true') {
          // This would be replaced with actual AI analysis in production
          const mockAiAnalysis = {
            contentType: evidenceType,
            identifiedElements: ['mock_element_1', 'mock_element_2'],
            confidence: 0.85
          };
          
          // Update evidence with AI analysis results
          await db.query(
            `UPDATE evidence SET ai_analysis_results = $1 WHERE id = $2`,
            [mockAiAnalysis, evidenceId]
          );
        }
      }
      
      return res.status(201).json({
        success: true,
        data: createdEvidence,
        message: `${createdEvidence.length} evidence items added successfully`
      });
    } catch (error) {
      console.error('Error adding evidence:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error adding evidence',
        error: error.message
      });
    }
  }
  
  // Other methods remain the same, but update deleteEvidence to use cloud storage
  
  // Delete evidence
  async deleteEvidence(req, res) {
    try {
      const evidenceId = req.params.id;
      
      // Get the evidence to check ownership and get file URL
      const evidence = await db.query(
        'SELECT e.*, r.user_id FROM evidence e JOIN reports r ON e.report_id = r.id WHERE e.id = $1',
        [evidenceId]
      );
      
      if (evidence.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Evidence not found'
        });
      }
      
      // Check if user has permission to delete this evidence
      if (!req.user.is_admin && req.user.id !== evidence.rows[0].user_id) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to delete this evidence'
        });
      }
      
      // Try to delete the file from cloud storage
      try {
        if (evidence.rows[0].file_url) {
          await storageService.deleteFile(evidence.rows[0].file_url);
        }
      } catch (fileError) {
        console.error('Error deleting file from storage:', fileError);
        // Continue with database deletion even if file deletion fails
      }
      
      // Delete the evidence record
      await db.query('DELETE FROM evidence WHERE id = $1', [evidenceId]);
      
      return res.status(200).json({
        success: true,
        message: 'Evidence deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting evidence:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error deleting evidence',
        error: error.message
      });
    }
  }
  
  // Get all evidence for a report
  async getEvidenceForReport(req, res) {
    try {
      const reportId = req.params.reportId;
      
      // Check if report exists
      const report = await db.query('SELECT * FROM reports WHERE id = $1', [reportId]);
      
      if (report.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Report not found'
        });
      }
      
      // Check if user has permission to view this report's evidence
      if (!req.user.is_admin && req.user.id !== report.rows[0].user_id) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to view this report\'s evidence'
        });
      }
      
      // Get all evidence for the report
      const evidence = await db.query(
        'SELECT * FROM evidence WHERE report_id = $1 ORDER BY submitted_date DESC',
        [reportId]
      );
      
      return res.status(200).json({
        success: true,
        count: evidence.rows.length,
        data: evidence.rows
      });
    } catch (error) {
      console.error('Error fetching evidence:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error fetching evidence',
        error: error.message
      });
    }
  }
  
  // Get single evidence by ID
  async getEvidenceById(req, res) {
    try {
      const evidenceId = req.params.id;
      
      // Get the evidence
      const evidence = await db.query(
        'SELECT e.*, r.user_id FROM evidence e JOIN reports r ON e.report_id = r.id WHERE e.id = $1',
        [evidenceId]
      );
      
      if (evidence.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Evidence not found'
        });
      }
      
      // Check if user has permission to view this evidence
      if (!req.user.is_admin && req.user.id !== evidence.rows[0].user_id) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to view this evidence'
        });
      }
      
      return res.status(200).json({
        success: true,
        data: evidence.rows[0]
      });
    } catch (error) {
      console.error('Error fetching evidence:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error fetching evidence',
        error: error.message
      });
    }
  }
  
  // Get signed URL for viewing evidence
  async getEvidenceSignedUrl(req, res) {
    try {
      const evidenceId = req.params.id;
      
      // Get the evidence record to check permissions and get file URL
      const evidence = await db.query(
        'SELECT e.*, r.user_id FROM evidence e JOIN reports r ON e.report_id = r.id WHERE e.id = $1',
        [evidenceId]
      );
      
      if (evidence.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Evidence not found'
        });
      }
      
      // Check if user has permission to view this evidence
      if (!req.user.is_admin && req.user.id !== evidence.rows[0].user_id) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to view this evidence'
        });
      }
      
      // Get the GCS URI from the database
      const gcsUri = evidence.rows[0].file_url;
      
      // Generate a signed URL (valid for 15 minutes)
      const signedUrl = await storageService.getSignedUrl(gcsUri, 15);
      
      return res.status(200).json({
        success: true,
        data: {
          evidenceId: evidence.rows[0].id,
          fileType: evidence.rows[0].evidence_type,
          description: evidence.rows[0].description,
          signedUrl: signedUrl
        }
      });
    } catch (error) {
      console.error('Error generating signed URL:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error generating signed URL',
        error: error.message
      });
    }
  }
  
  // Update evidence description
  async updateEvidenceDescription(req, res) {
    try {
      const evidenceId = req.params.id;
      const { description } = req.body;
      
      if (!description) {
        return res.status(400).json({
          success: false,
          message: 'Description is required'
        });
      }
      
      // Get the evidence to check ownership
      const evidence = await db.query(
        'SELECT e.*, r.user_id FROM evidence e JOIN reports r ON e.report_id = r.id WHERE e.id = $1',
        [evidenceId]
      );
      
      if (evidence.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Evidence not found'
        });
      }
      
      // Check if user has permission to update this evidence
      if (!req.user.is_admin && req.user.id !== evidence.rows[0].user_id) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to update this evidence'
        });
      }
      
      // Update the evidence description
      const updatedEvidence = await db.query(
        'UPDATE evidence SET description = $1 WHERE id = $2 RETURNING *',
        [description, evidenceId]
      );
      
      return res.status(200).json({
        success: true,
        data: updatedEvidence.rows[0],
        message: 'Evidence description updated successfully'
      });
    } catch (error) {
      console.error('Error updating evidence description:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error updating evidence description',
        error: error.message
      });
    }
  }
}

module.exports = new EvidenceController();