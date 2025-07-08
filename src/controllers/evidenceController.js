// src/controllers/evidenceController.js
const { v4: uuidv4 } = require('uuid');
const fs = require('fs'); 
const db = require('../config/database');
const storageService = require('../services/storageService');

class EvidenceController {
  constructor() {
    this.generateEvidenceUrls = this.generateEvidenceUrls.bind(this);
    this.categorizeEvidence = this.categorizeEvidence.bind(this);
    this.getEvidenceForReport = this.getEvidenceForReport.bind(this);
    this.getEvidenceById = this.getEvidenceById.bind(this);
    this.getEvidenceForReportDetails = this.getEvidenceForReportDetails.bind(this);
    this.addEvidence = this.addEvidence.bind(this);
    this.deleteEvidence = this.deleteEvidence.bind(this);
    this.getEvidenceSignedUrl = this.getEvidenceSignedUrl.bind(this);
    this.updateEvidenceDescription = this.updateEvidenceDescription.bind(this);
  }
  // Helper method to generate signed URLs for evidence
  // Inside EvidenceController class
async generateEvidenceUrls(evidenceItems, maxRetries = 3) {
  const evidenceWithUrls = [];

  for (const evidence of evidenceItems) {
    let attempt = 0;
    let signedUrl = null;

    while (attempt < maxRetries) {
      try {
        signedUrl = await storageService.getSignedUrl(evidence.file_url, 5); // 5-minute validity
        break; // success, exit retry loop
      } catch (error) {
        attempt++;
        console.warn(`Retry ${attempt}/${maxRetries} for ${evidence.id}:`, error.message);
        await new Promise(resolve => setTimeout(resolve, 300 * attempt)); // Backoff
      }
    }

    evidenceWithUrls.push({
      ...evidence,
      viewUrl: signedUrl,
      downloadUrl: signedUrl,
      error: signedUrl ? null : 'Unable to generate signed URL'
    });
  }

  return evidenceWithUrls;
}


  // Helper method to categorize evidence by type
  categorizeEvidence(evidenceItems) {
    const categorized = {
      images: [],
      audios: [],
      videos: [],
      documents: []
    };

    evidenceItems.forEach(evidence => {
      switch (evidence.evidence_type) {
        case 'image':
          categorized.images.push(evidence);
          break;
        case 'audio':
          categorized.audios.push(evidence);
          break;
        case 'video':
          categorized.videos.push(evidence);
          break;
        case 'document':
        default:
          categorized.documents.push(evidence);
          break;
      }
    });

    return categorized;
  }

  // Modified method to get all evidence for a report with URLs and categorization
  async getEvidenceForReport(req, res) {
    try {
      const reportId = req.params.reportId;
      const { categorize = 'false' } = req.query;
  
      const report = await db.query('SELECT * FROM reports WHERE id = $1', [reportId]);
      if (report.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Report not found' });
      }
  
      if (!req.user.is_admin && req.user.id !== report.rows[0].user_id) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
  
      const evidence = await db.query(
        'SELECT * FROM evidence WHERE report_id = $1 ORDER BY submitted_date DESC',
        [reportId]
      );
  
      const evidenceWithUrls = await this.generateEvidenceUrls(evidence.rows);
  
      if (categorize === 'true') {
        const categorized = this.categorizeEvidence(evidenceWithUrls);
        return res.status(200).json({
          success: true,
          data: categorized
        });
      }
  
      return res.status(200).json({
        success: true,
        count: evidenceWithUrls.length,
        data: evidenceWithUrls
      });
  
    } catch (error) {
      console.error('Error fetching evidence:', error);
      return res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
  }  

// getEvidenceById - simplified
async getEvidenceById(req, res) {
  try {
    const evidenceId = req.params.id;

    const evidence = await db.query(
      'SELECT e.*, r.user_id FROM evidence e JOIN reports r ON e.report_id = r.id WHERE e.id = $1',
      [evidenceId]
    );

    if (evidence.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Evidence not found' });
    }

    if (!req.user.is_admin && req.user.id !== evidence.rows[0].user_id) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const [withUrl] = await this.generateEvidenceUrls([evidence.rows[0]]);
    return res.status(200).json({ success: true, data: withUrl });

  } catch (error) {
    console.error('Error fetching evidence:', error);
    return res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
}


// getEvidenceForReportDetails - simplified
async getEvidenceForReportDetails(reportId, userId, isAdmin = false) {
  try {
    const evidence = await db.query(
      'SELECT * FROM evidence WHERE report_id = $1 ORDER BY submitted_date DESC',
      [reportId]
    );

    const evidenceWithUrls = await this.generateEvidenceUrls(evidence.rows);
    const categorizedEvidence = this.categorizeEvidence(evidenceWithUrls);

    return {
      success: true,
      evidence: categorizedEvidence,
      summary: {
        total: evidenceWithUrls.length,
        images: categorizedEvidence.images.length,
        audios: categorizedEvidence.audios.length,
        videos: categorizedEvidence.videos.length,
        documents: categorizedEvidence.documents.length
      }
    };

  } catch (error) {
    console.error('Error fetching evidence for report details:', error);
    return {
      success: false,
      evidence: { images: [], audios: [], videos: [], documents: [] },
      summary: { total: 0, images: 0, audios: 0, videos: 0, documents: 0 },
      error: error.message
    };
  }
}


  // Existing methods remain the same...
  async addEvidence(req, res) {
    try {
      console.log('Evidence controller called');
      const reportId = req.params.reportId;
      console.log('Report ID:', reportId);
      
      // Check if files were uploaded
      console.log('Files:', req.files);
      console.log('File:', req.file);
      
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
      
      // Generate URLs for the created evidence
      const evidenceWithUrls = await this.generateEvidenceUrls(createdEvidence);
      
      return res.status(201).json({
        success: true,
        data: evidenceWithUrls,
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

  // Other existing methods remain unchanged...
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

  // Keep the existing getEvidenceSignedUrl method for backward compatibility
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
      
      // Generate URLs for the updated evidence
      const evidenceWithUrls = await this.generateEvidenceUrls([updatedEvidence.rows[0]]);
      
      return res.status(200).json({
        success: true,
        data: evidenceWithUrls[0],
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