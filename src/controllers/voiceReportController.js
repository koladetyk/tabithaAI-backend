// src/controllers/voiceReportController.js
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const { processVoiceInput, recordInteraction } = require('../services/enhancedAiService');
const notificationService = require('../services/notificationService');

class VoiceReportController {
  // Handle voice report submission
  async submitVoiceReport(req, res) {
    try {
      // Check if file was uploaded
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No audio file uploaded'
        });
      }
      
      const audioFilePath = req.file.path;
      const language = req.body.language || 'en';
      const anonymous = req.body.anonymous === 'true';
      
      // Process the voice input
      const processingResult = await processVoiceInput(audioFilePath, language);
      
      if (!processingResult || processingResult.error) {
        return res.status(500).json({
          success: false,
          message: 'Failed to process voice input',
          error: processingResult?.error || 'Unknown error'
        });
      }
      
      // Generate report ID
      const reportId = uuidv4();
      
      // Extract data from AI analysis
      const aiAnalysis = processingResult.aiAnalysis;
      const incidentType = aiAnalysis.structuredData?.incidentType || 'verbal incident';
      const locationData = {
        type: aiAnalysis.structuredData?.location || 'Unknown',
        description: 'Extracted from voice report'
      };
      
      // Create report in database
      const newReport = await db.query(
        `INSERT INTO reports (
          id,
          user_id,
          anonymous,
          incident_date,
          report_date,
          location_data,
          incident_type,
          incident_description,
          emotional_context,
          status,
          language,
          confidentiality_level,
          original_input_type,
          original_content_ref,
          ai_processed,
          created_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING *`,
        [
          reportId,
          anonymous ? null : req.user.id,
          anonymous,
          new Date(),
          locationData,
          incidentType,
          processingResult.transcription,
          aiAnalysis.emotionalContext || {},
          'submitted',
          language,
          parseInt(req.body.confidentiality_level) || 1,
          'voice',
          audioFilePath,
          true
        ]
      );
      
      // Record the AI interaction AFTER report creation (fixes foreign key constraint)
      try {
        await recordInteraction(
          anonymous ? null : req.user.id,
          reportId,
          'voice_processing',
          `Voice transcription: ${processingResult.transcription.substring(0, 100)}${processingResult.transcription.length > 100 ? '...' : ''}`,
          JSON.stringify(aiAnalysis),
          aiAnalysis.confidence || 0.7,
          aiAnalysis.processingTime || 1000,
          aiAnalysis.model || 'whisper+ai_model'
        );
      } catch (interactionError) {
        console.error('Error recording AI interaction:', interactionError);
        // Continue even if recording fails
      }
      
      // Create notification for non-anonymous reports
      if (!anonymous && req.user.id) {
        await notificationService.createAndSendNotification(
          req.user.id,
          'Voice Report Processed',
          'Your voice report has been successfully processed and submitted',
          'report_created',
          'report',
          reportId
        );
      }
      
      return res.status(201).json({
        success: true,
        data: {
          report: newReport.rows[0],
          transcription: processingResult.transcription,
          analysis: aiAnalysis
        },
        message: 'Voice report processed and submitted successfully'
      });
    } catch (error) {
      console.error('Error processing voice report:', error);
      
      // Clean up the uploaded file if there was an error
      if (req.file && req.file.path) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (unlinkError) {
          console.error('Error deleting file:', unlinkError);
        }
      }
      
      return res.status(500).json({
        success: false,
        message: 'Server error processing voice report',
        error: error.message
      });
    }
  }
  
  // Get voice file for a report
  async getVoiceFile(req, res) {
    try {
      const reportId = req.params.id;
      
      // Get the report
      const report = await db.query(
        'SELECT * FROM reports WHERE id = $1 AND original_input_type = $2',
        [reportId, 'voice']
      );
      
      if (report.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Voice report not found'
        });
      }
      
      // Check if user has permission to access this report
      if (!req.user.is_admin && req.user.id !== report.rows[0].user_id) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to access this voice file'
        });
      }
      
      const filePath = report.rows[0].original_content_ref;
      
      // Check if file exists
      if (!filePath || !fs.existsSync(filePath)) {
        return res.status(404).json({
          success: false,
          message: 'Voice file not found'
        });
      }
      
      // Send the file
      return res.sendFile(path.resolve(filePath));
    } catch (error) {
      console.error('Error retrieving voice file:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error retrieving voice file',
        error: error.message
      });
    }
  }
  
  // Reanalyze a voice report
  async reanalyzeVoiceReport(req, res) {
    try {
      const reportId = req.params.id;
      
      // Get the report
      const report = await db.query(
        'SELECT * FROM reports WHERE id = $1 AND original_input_type = $2',
        [reportId, 'voice']
      );
      
      if (report.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Voice report not found'
        });
      }
      
      // Check if user has permission to reanalyze this report
      if (!req.user.is_admin && req.user.id !== report.rows[0].user_id) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to reanalyze this report'
        });
      }
      
      const filePath = report.rows[0].original_content_ref;
      const language = report.rows[0].language || 'en';
      
      // Check if file exists
      if (!filePath || !fs.existsSync(filePath)) {
        return res.status(404).json({
          success: false,
          message: 'Original voice file not found'
        });
      }
      
      // Process the voice input again
      const processingResult = await processVoiceInput(filePath, language);
      
      if (!processingResult || processingResult.error) {
        return res.status(500).json({
          success: false,
          message: 'Failed to reprocess voice input',
          error: processingResult?.error || 'Unknown error'
        });
      }
      
      // Update the report with new analysis
      const updatedReport = await db.query(
        `UPDATE reports SET
          incident_description = $1,
          emotional_context = $2,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $3 RETURNING *`,
        [
          processingResult.transcription,
          processingResult.aiAnalysis.emotionalContext || {},
          reportId
        ]
      );
      
      // Record the AI interaction
      try {
        await recordInteraction(
          report.rows[0].user_id,
          reportId,
          'voice_reanalysis',
          `Voice retranscription: ${processingResult.transcription.substring(0, 100)}${processingResult.transcription.length > 100 ? '...' : ''}`,
          JSON.stringify(processingResult.aiAnalysis),
          processingResult.aiAnalysis.confidence || 0.7,
          processingResult.aiAnalysis.processingTime || 1000,
          processingResult.aiAnalysis.model || 'whisper+ai_model'
        );
      } catch (interactionError) {
        console.error('Error recording AI interaction for reanalysis:', interactionError);
        // Continue even if recording fails
      }
      
      // Send notification about reanalysis
      if (report.rows[0].user_id) {
        await notificationService.createAndSendNotification(
          report.rows[0].user_id,
          'Voice Report Reanalyzed',
          'Your voice report has been reprocessed with our latest AI technology',
          'report_reanalyzed',
          'report',
          reportId
        );
      }
      
      return res.status(200).json({
        success: true,
        data: {
          report: updatedReport.rows[0],
          transcription: processingResult.transcription,
          analysis: processingResult.aiAnalysis
        },
        message: 'Voice report reanalyzed successfully'
      });
    } catch (error) {
      console.error('Error reanalyzing voice report:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error reanalyzing voice report',
        error: error.message
      });
    }
  }
}

module.exports = new VoiceReportController();