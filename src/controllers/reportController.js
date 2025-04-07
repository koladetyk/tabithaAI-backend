const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const { processWithAI, recordInteraction } = require('../services/enhancedAiService');
const notificationService = require('../services/notificationService');
const storageService = require('../services/storageService');

class ReportController {
  // Get all reports (admin only)
  async getAllReports(req, res) {
    try {
      // Check if user is admin
      if (!req.user.is_admin) {
        return res.status(403).json({
          success: false,
          message: 'Unauthorized. Admin access required.'
        });
      }
      
      const reports = await db.query(
        'SELECT * FROM reports ORDER BY created_at DESC'
      );
      
      return res.status(200).json({
        success: true,
        count: reports.rows.length,
        data: reports.rows
      });
    } catch (error) {
      console.error('Error fetching reports:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error retrieving reports',
        error: error.message
      });
    }
  }

  // Get individual report by ID
  async getReportById(req, res) {
    try {
      const reportId = req.params.id;
      
      // Fetch the report with evidence and referrals
      const report = await db.query(
        `SELECT r.*, 
          COALESCE(json_agg(e.*) FILTER (WHERE e.id IS NOT NULL), '[]') as evidence,
          COALESCE(json_agg(ref.*) FILTER (WHERE ref.id IS NOT NULL), '[]') as referrals
        FROM reports r
        LEFT JOIN evidence e ON r.id = e.report_id
        LEFT JOIN referrals ref ON r.id = ref.report_id
        WHERE r.id = $1
        GROUP BY r.id`,
        [reportId]
      );
      
      // Check if report exists
      if (report.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Report not found'
        });
      }
      
      // Check if user has permission to access this report
      if (!req.user.is_admin && req.user.id !== report.rows[0].user_id) {
        return res.status(403).json({
          success: false,
          message: 'Unauthorized access to this report'
        });
      }
      
      return res.status(200).json({
        success: true,
        data: report.rows[0]
      });
    } catch (error) {
      console.error('Error fetching report:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error retrieving report',
        error: error.message
      });
    }
  }

  // Get reports by user ID
async getReportsByUserId(req, res) {
  try {
    const userId = req.params.userId;
    
    // Check if user has permission (only admin or the user themselves)
    if (!req.user.is_admin && req.user.id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized access to these reports'
      });
    }
    
    // Fetch reports for the specified user
    const reports = await db.query(
      'SELECT * FROM reports WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );
    
    return res.status(200).json({
      success: true,
      count: reports.rows.length,
      data: reports.rows
    });
  } catch (error) {
    console.error('Error fetching user reports:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error retrieving user reports',
      error: error.message
    });
  }
}

// Create new report with evidence files
async createReport(req, res) {
  try {
    const {
      incident_date,
      location_data,
      incident_type,
      incident_description,
      language,
      anonymous,
      confidentiality_level,
      original_input_type,
      evidence_description
    } = req.body;
    
    // Generate new UUID for report
    const reportId = uuidv4();
    
    // Process with AI if there's a description
    let aiProcessed = false;
    let emotionalContext = null;
    let aiResult = null;
    let processingTime = null;
    
    if (incident_description) {
      // Use enhanced AI service with Llama3
      aiResult = await processWithAI(incident_description, language || 'en');
      
      if (aiResult) {
        aiProcessed = true;
        emotionalContext = aiResult.emotionalContext || null;
        processingTime = aiResult.processingTime || null;
      }
    }
    
    // Determine incident type from AI if not provided
    const finalIncidentType = incident_type || 
                             (aiResult?.structuredData?.incidentType || 'general incident');
    
    // Create new report in database
    const newReport = await db.query(
      `INSERT INTO reports (
        id, 
        user_id, 
        incident_date, 
        location_data, 
        incident_type, 
        incident_description,
        language,
        anonymous,
        confidentiality_level,
        original_input_type,
        ai_processed,
        emotional_context
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [
        reportId,
        anonymous ? null : req.user.id,
        incident_date || new Date(),
        location_data || {},
        finalIncidentType,
        incident_description,
        language || 'en',
        anonymous || false,
        confidentiality_level || 1,
        original_input_type || 'text',
        aiProcessed,
        emotionalContext
      ]
    );
    
    // Record the AI interaction AFTER report creation
    if (aiResult) {
      try {
        await recordInteraction(
          anonymous ? null : req.user.id,
          reportId, // Now the report exists in the database
          'text_processing',
          incident_description.substring(0, 200),
          JSON.stringify(aiResult),
          aiResult.confidence || 0.7,
          processingTime,
          'llama3'
        );
      } catch (interactionError) {
        console.error('Error recording AI interaction:', interactionError);
        // Continue even if recording fails
      }
    }
    
    // Handle uploaded files if any
    const evidenceItems = [];
    if (req.files && req.files.length > 0) {
      // Process each file as evidence
      for (const file of req.files) {
        // Generate evidence ID
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
        
        // Upload file to cloud storage
        const fileUrl = await storageService.uploadFile(
          file,
          req.user.id,
          reportId,
          evidenceType
        );
        
        // Create evidence record
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
            file.originalname,
            fileUrl,
            evidence_description || null
          ]
        );
        
        evidenceItems.push(newEvidence.rows[0]);
        
        // Analyze evidence with AI if requested
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
    }
    
    // Create notification for non-anonymous reports
    if (!anonymous && req.user.id) {
      await notificationService.createAndSendNotification(
        req.user.id,
        'Report Submitted',
        'Your report has been successfully submitted',
        'report_created',
        'report',
        reportId
      );
    }
    
    return res.status(201).json({
      success: true,
      data: {
        report: newReport.rows[0],
        evidence: evidenceItems
      },
      aiAnalysis: aiResult ? {
        suggestedServices: aiResult.suggestedServices,
        recommendations: aiResult.recommendations,
        riskLevel: aiResult.structuredData?.riskLevel
      } : null,
      message: `Report created successfully with ${evidenceItems.length} evidence items`
    });
  } catch (error) {
    console.error('Error creating report:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error creating report',
      error: error.message
    });
  }
}

  // Update report
  async updateReport(req, res) {
    try {
      const reportId = req.params.id;
      const {
        incident_date,
        location_data,
        incident_type,
        incident_description,
        language
      } = req.body;
      
      // Check if report exists
      const existingReport = await db.query(
        'SELECT * FROM reports WHERE id = $1',
        [reportId]
      );
      
      if (existingReport.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Report not found'
        });
      }
      
      // Check if user has permission to update this report
      if (!req.user.is_admin && req.user.id !== existingReport.rows[0].user_id) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to update this report'
        });
      }
      
      // Process with AI if description is updated
      let aiProcessed = existingReport.rows[0].ai_processed;
      let emotionalContext = existingReport.rows[0].emotional_context;
      let aiResult = null;
      
      if (incident_description && incident_description !== existingReport.rows[0].incident_description) {
        aiResult = await processWithAI(
          incident_description, 
          language || existingReport.rows[0].language
        );
        
        if (aiResult) {
          aiProcessed = true;
          emotionalContext = aiResult.emotionalContext || emotionalContext;
          
          // Record the AI interaction
          await recordInteraction(
            existingReport.rows[0].user_id,
            reportId,
            'text_processing_update',
            incident_description.substring(0, 200),
            JSON.stringify(aiResult),
            aiResult.confidence || 0.7,
            aiResult.processingTime || null,
            'llama3'
          );
        }
      }
      
      // Determine incident type if needed
      const finalIncidentType = incident_type || 
                              (aiResult?.structuredData?.incidentType) || 
                              existingReport.rows[0].incident_type;
      
      // Update report
      const updatedReport = await db.query(
        `UPDATE reports SET 
          incident_date = COALESCE($1, incident_date),
          location_data = COALESCE($2, location_data),
          incident_type = COALESCE($3, incident_type),
          incident_description = COALESCE($4, incident_description),
          language = COALESCE($5, language),
          ai_processed = $6,
          emotional_context = COALESCE($7, emotional_context),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $8
        RETURNING *`,
        [
          incident_date,
          location_data ? location_data : existingReport.rows[0].location_data,
          finalIncidentType,
          incident_description,
          language,
          aiProcessed,
          emotionalContext,
          reportId
        ]
      );
      
      // Send notification if the report was updated
      if (existingReport.rows[0].user_id) {
        await notificationService.createAndSendNotification(
          existingReport.rows[0].user_id,
          'Report Updated',
          'Your report has been updated',
          'report_updated',
          'report',
          reportId
        );
      }
      
      return res.status(200).json({
        success: true,
        data: updatedReport.rows[0],
        aiAnalysis: aiResult ? {
          suggestedServices: aiResult.suggestedServices,
          recommendations: aiResult.recommendations,
          riskLevel: aiResult.structuredData?.riskLevel
        } : null,
        message: 'Report updated successfully'
      });
    } catch (error) {
      console.error('Error updating report:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error updating report',
        error: error.message
      });
    }
  }

  // Archive report
  async archiveReport(req, res) {
    try {
      const reportId = req.params.id;
      
      // Check if report exists
      const existingReport = await db.query(
        'SELECT * FROM reports WHERE id = $1',
        [reportId]
      );
      
      if (existingReport.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Report not found'
        });
      }
      
      // Check if user has permission to archive this report
      if (!req.user.is_admin && req.user.id !== existingReport.rows[0].user_id) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to archive this report'
        });
      }
      
      // Archive report (we'll use status = 'archived' instead of deleting)
      const archivedReport = await db.query(
        `UPDATE reports SET
          status = 'archived',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *`,
        [reportId]
      );
      
      // Send notification if the report was archived
      if (existingReport.rows[0].user_id) {
        await notificationService.createAndSendNotification(
          existingReport.rows[0].user_id,
          'Report Archived',
          'Your report has been archived',
          'report_archived',
          'report',
          reportId
        );
      }
      
      return res.status(200).json({
        success: true,
        data: archivedReport.rows[0],
        message: 'Report archived successfully'
      });
    } catch (error) {
      console.error('Error archiving report:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error archiving report',
        error: error.message
      });
    }
  }

  // Delete report (admin only)
  async deleteReport(req, res) {
    try {
      const reportId = req.params.id;
      
      // Check if user is admin
      if (!req.user.is_admin) {
        return res.status(403).json({
          success: false,
          message: 'Admin privileges required to delete reports'
        });
      }
      
      // Check if report exists
      const existingReport = await db.query(
        'SELECT * FROM reports WHERE id = $1',
        [reportId]
      );
      
      if (existingReport.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Report not found'
        });
      }
      
      // Delete related evidence and referrals first (due to foreign key constraints)
      await db.query('DELETE FROM evidence WHERE report_id = $1', [reportId]);
      await db.query('DELETE FROM referrals WHERE report_id = $1', [reportId]);
      await db.query('DELETE FROM ai_interactions WHERE report_id = $1', [reportId]);
      
      // Delete the report
      await db.query('DELETE FROM reports WHERE id = $1', [reportId]);
      
      return res.status(200).json({
        success: true,
        message: 'Report and all related data deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting report:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error deleting report',
        error: error.message
      });
    }
  }

  // Update report status
  async updateReportStatus(req, res) {
    try {
      const reportId = req.params.id;
      const { status } = req.body;
      
      // Validate status
      const validStatuses = ['submitted', 'under_review', 'in_progress', 'resolved', 'closed', 'archived'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status. Status must be one of: ${validStatuses.join(', ')}`
        });
      }
      
      // Check if report exists
      const existingReport = await db.query(
        'SELECT * FROM reports WHERE id = $1',
        [reportId]
      );
      
      if (existingReport.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Report not found'
        });
      }
      
      // Check permissions based on status change
      if (!req.user.is_admin && req.user.id !== existingReport.rows[0].user_id) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to update this report status'
        });
      }
      
      // Update report status
      const updatedReport = await db.query(
        `UPDATE reports SET
          status = $1,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        RETURNING *`,
        [status, reportId]
      );
      
      // Send notification if user isn't anonymous and status has changed
      if (existingReport.rows[0].user_id && status !== existingReport.rows[0].status) {
        await notificationService.sendReportStatusNotification(
          existingReport.rows[0].user_id,
          reportId,
          status
        );
      }
      
      return res.status(200).json({
        success: true,
        data: updatedReport.rows[0],
        message: `Report status updated to "${status}" successfully`
      });
    } catch (error) {
      console.error('Error updating report status:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error updating report status',
        error: error.message
      });
    }
  }

  // Analyze existing report with enhanced AI
  async reanalyzeReport(req, res) {
    try {
      const reportId = req.params.id;
      
      // Check if report exists
      const existingReport = await db.query(
        'SELECT * FROM reports WHERE id = $1',
        [reportId]
      );
      
      if (existingReport.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Report not found'
        });
      }
      
      // Check permissions
      if (!req.user.is_admin && req.user.id !== existingReport.rows[0].user_id) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to reanalyze this report'
        });
      }
      
      // Check if the report has a description to analyze
      if (!existingReport.rows[0].incident_description) {
        return res.status(400).json({
          success: false,
          message: 'Report has no incident description to analyze'
        });
      }
      
      // Use enhanced AI service to reanalyze
      const aiResult = await processWithAI(
        existingReport.rows[0].incident_description,
        existingReport.rows[0].language || 'en'
      );
      
      if (!aiResult) {
        return res.status(500).json({
          success: false,
          message: 'AI analysis failed'
        });
      }
      
      // Update report with new analysis
      const updatedReport = await db.query(
        `UPDATE reports SET
          emotional_context = $1,
          ai_processed = true,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        RETURNING *`,
        [aiResult.emotionalContext || {}, reportId]
      );
      
      // Record the AI interaction
      await recordInteraction(
        existingReport.rows[0].user_id,
        reportId,
        'reanalysis',
        existingReport.rows[0].incident_description.substring(0, 200),
        JSON.stringify(aiResult),
        aiResult.confidence || 0.7,
        aiResult.processingTime || null,
        aiResult.model || 'ai_model'
      );
      
      // Send notification about reanalysis
      if (existingReport.rows[0].user_id) {
        await notificationService.createAndSendNotification(
          existingReport.rows[0].user_id,
          'Report Reanalyzed',
          'Your report has been reanalyzed with our enhanced AI',
          'report_reanalyzed',
          'report',
          reportId
        );
      }
      
      return res.status(200).json({
        success: true,
        data: updatedReport.rows[0],
        aiAnalysis: {
          emotionalContext: aiResult.emotionalContext,
          structuredData: aiResult.structuredData,
          suggestedServices: aiResult.suggestedServices,
          recommendations: aiResult.recommendations,
          confidence: aiResult.confidence
        },
        message: 'Report reanalyzed successfully'
      });
    } catch (error) {
      console.error('Error reanalyzing report:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error reanalyzing report',
        error: error.message
      });
    }
  }
}

module.exports = new ReportController();