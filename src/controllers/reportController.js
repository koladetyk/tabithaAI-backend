const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const { processWithAI, recordInteraction } = require('../services/enhancedAiService');
const notificationService = require('../services/notificationService');
const storageService = require('../services/storageService');
const evidenceController = require('./evidenceController');

class ReportController {
  

  // Update your getReportById method to include evidence with URLs
// Update your getReportById method to include evidence with URLs
async getReportById(req, res) {
  try {
    const reportId = req.params.id;
    
    // Get the report
    const report = await db.query(
      'SELECT * FROM reports WHERE id = $1',
      [reportId]
    );
    
    if (report.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Report not found'
      });
    }
    
    // Check if user has permission to view this report
    if (!req.user.is_admin && req.user.id !== report.rows[0].user_id) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view this report'
      });
    }
    
    // Get evidence for this report with URLs and categorization
    const evidenceResult = await evidenceController.getEvidenceForReportDetails(
      reportId, 
      req.user.id, 
      req.user.is_admin
    );
    
    // Return report with evidence
    return res.status(200).json({
      success: true,
      data: {
        ...report.rows[0],
        evidence: evidenceResult.evidence,
        evidenceSummary: evidenceResult.summary
      }
    });
  } catch (error) {
    console.error('Error fetching report:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error fetching report',
      error: error.message
    });
  }
}

// Update your getAllReports method to include evidence summaries
async getAllReports(req, res) {
  try {
    const { page = 1, limit = 10, status, incident_type } = req.query;
    const offset = (page - 1) * limit;
    
    // Build query based on user role and filters
    let query = 'SELECT * FROM reports';
    let countQuery = 'SELECT COUNT(*) FROM reports';
    let queryParams = [];
    let conditions = [];
    
    // Add user permission check
    if (!req.user.is_admin) {
      conditions.push('user_id = $' + (queryParams.length + 1));
      queryParams.push(req.user.id);
    }
    
    // Add filters
    if (status) {
      conditions.push('status = $' + (queryParams.length + 1));
      queryParams.push(status);
    }
    
    if (incident_type) {
      conditions.push('incident_type = $' + (queryParams.length + 1));
      queryParams.push(incident_type);
    }
    
    // Add WHERE clause if conditions exist
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
      countQuery += ' WHERE ' + conditions.join(' AND ');
    }
    
    // Add pagination
    query += ' ORDER BY submitted_date DESC LIMIT $' + (queryParams.length + 1) + ' OFFSET $' + (queryParams.length + 2);
    queryParams.push(limit, offset);
    
    // Execute queries
    const [reports, totalCount] = await Promise.all([
      db.query(query, queryParams),
      db.query(countQuery, queryParams.slice(0, -2)) // Remove limit and offset for count
    ]);
    
    // Get evidence summaries for all reports
    const reportIds = reports.rows.map(report => report.id);
    const evidenceSummaries = await evidenceController.getEvidenceSummaryForReports(reportIds);
    
    // Add evidence summaries to reports
    const reportsWithEvidence = reports.rows.map(report => ({
      ...report,
      evidenceSummary: evidenceSummaries[report.id] || { total: 0, images: 0, audios: 0, videos: 0, documents: 0 }
    }));
    
    return res.status(200).json({
      success: true,
      data: reportsWithEvidence,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(totalCount.rows[0].count),
        pages: Math.ceil(totalCount.rows[0].count / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching reports:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error fetching reports',
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

  // Get reports by email/phone for user assistance
async getReportsByContact(req, res) {
  try {
    // Change from req.body to req.query for GET request
    const { email, phoneNumber } = req.query;
    
    if (!email && !phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Either email or phoneNumber query parameter is required'
      });
    }
    
    let query = '';
    let params = [];
    
    if (email && phoneNumber) {
      query = `SELECT * FROM reports 
              WHERE contact_info->>'email' = $1 
              OR contact_info->>'phoneNumber' = $2 
              ORDER BY created_at DESC`;
      params = [email, phoneNumber];
    } else if (email) {
      query = `SELECT * FROM reports 
              WHERE contact_info->>'email' = $1 
              ORDER BY created_at DESC`;
      params = [email];
    } else {
      query = `SELECT * FROM reports 
              WHERE contact_info->>'phoneNumber' = $1 
              ORDER BY created_at DESC`;
      params = [phoneNumber];
    }
    
    const reports = await db.query(query, params);
    
    // Include evidence with each report
    if (reports.rows.length > 0) {
      for (let i = 0; i < reports.rows.length; i++) {
        const evidence = await db.query(
          'SELECT * FROM evidence WHERE report_id = $1',
          [reports.rows[i].id]
        );
        reports.rows[i].evidence = evidence.rows;
      }
    }
    
    return res.status(200).json({
      success: true,
      count: reports.rows.length,
      data: reports.rows
    });
  } catch (error) {
    console.error('Error fetching reports by contact:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error retrieving reports',
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

  // ENHANCED: Create new report with array structure as per your requirements
  async createReport(req, res) {
    try {
      const {
        audio_files,        // Array of {title, uri, transcription}
        images_videos,      // Array of {title, uri}
        note,              // Optional text note
        email,             // Required contact info
        phoneNumber,       // Required contact info  
        address,           // Required contact info
        incident_date,
        incident_type,
        language,
        anonymous,
        confidentiality_level
      } = req.body;
      
      // Validate required contact info
      if (!email && !phoneNumber && !address) {
        return res.status(400).json({
          success: false,
          message: 'At least one contact method (email, phoneNumber, or address) is required'
        });
      }
      
      // Parse arrays if they come as strings (from form data)
      let parsedAudioFiles = [];
      let parsedImagesVideos = [];
      
      try {
        parsedAudioFiles = typeof audio_files === 'string' ? JSON.parse(audio_files) : (audio_files || []);
        parsedImagesVideos = typeof images_videos === 'string' ? JSON.parse(images_videos) : (images_videos || []);
      } catch (parseError) {
        console.log('Parse error for arrays, using empty arrays:', parseError.message);
      }
      
      // Generate new UUID for report
      const reportId = uuidv4();
      
      // Process with AI if there's a note or audio transcriptions
      let aiProcessed = false;
      let emotionalContext = null;
      let aiResult = null;
      let processingTime = null;
      
      // Combine text for AI analysis
      let textToAnalyze = note || '';
      if (parsedAudioFiles.length > 0) {
        const transcriptions = parsedAudioFiles
          .filter(audio => audio.transcription)
          .map(audio => audio.transcription)
          .join(' ');
        textToAnalyze += ' ' + transcriptions;
      }
      
      if (textToAnalyze.trim()) {
        // Use enhanced AI service with Llama3
        aiResult = await processWithAI(textToAnalyze.trim(), language || 'en');
        
        if (aiResult) {
          aiProcessed = true;
          emotionalContext = aiResult.emotionalContext || null;
          processingTime = aiResult.processingTime || null;
        }
      }
      
      // Determine incident type from AI if not provided
      const finalIncidentType = incident_type || 
                              (aiResult?.structuredData?.incidentType || 'general incident');
      
      // Create contact info object
      const contactInfo = {
        email: email || null,
        phoneNumber: phoneNumber || null,
        address: address || null
      };

      const title = `Case-${reportId.slice(0, 8)}`;
      
      // Create new report in database
      const newReport = await db.query(
        `INSERT INTO reports (
          id, 
          title,
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
          emotional_context,
          contact_info
        ) VALUES (
          $1, 
          $2, 
          $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
        ) RETURNING *`,
        [
          reportId,
          title,
          anonymous ? null : req.user?.id,
          incident_date || new Date(),
          address ? { address } : {},
          finalIncidentType,
          note || textToAnalyze || 'Report with media files',
          language || 'en',
          anonymous || false,
          confidentiality_level || 1,
          parsedAudioFiles.length > 0 ? 'audio' : 'mixed',
          aiProcessed,
          emotionalContext,
          contactInfo
        ]
      );
      
      // Record the AI interaction AFTER report creation
      if (aiResult) {
        try {
          await recordInteraction(
            anonymous ? null : req.user?.id,
            reportId,
            'array_structure_processing',
            textToAnalyze.substring(0, 200),
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
      
      // Create email verification for anonymous reports with email
      let verificationCode = null;
      if (anonymous && email) {
        try {
          // Use fixed verification code for testing
          verificationCode = "12345";
          
          // Create verification record
          await db.query(
            `INSERT INTO report_email_verification (
              id, 
              report_id, 
              email, 
              verification_code,
              expires_at
            ) VALUES ($1, $2, $3, $4, $5)`,
            [
              uuidv4(),
              reportId,
              email,
              verificationCode,
              new Date(Date.now() + 1000 * 60 * 60 * 24 * 30) // 30 days expiration
            ]
          );
          
          console.log(`TEST MODE: Using fixed verification code "12345" for ${email}`);
        } catch (verificationError) {
          console.error('Error creating email verification:', verificationError);
          // Continue even if verification creation fails
        }
      }
      
      // Handle audio files array
      const evidenceItems = [];
      for (const audioFile of parsedAudioFiles) {
        const evidenceId = uuidv4();
        
        const newEvidence = await db.query(
          `INSERT INTO evidence (
            id,
            report_id,
            evidence_type,
            file_path,
            file_url,
            description,
            submitted_date,
            metadata
          ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, $7) RETURNING *`,
          [
            evidenceId,
            reportId,
            'audio',
            audioFile.title || 'Audio File',
            audioFile.uri || null,
            audioFile.title || 'Audio evidence',
            {
              title: audioFile.title,
              uri: audioFile.uri,
              transcription: audioFile.transcription,
              contact_info: contactInfo
            }
          ]
        );
        
        evidenceItems.push(newEvidence.rows[0]);
      }
      
      // Handle images/videos array
      for (const mediaFile of parsedImagesVideos) {
        const evidenceId = uuidv4();
        
        // Determine type based on file extension or assume image
        let evidenceType = 'image';
        if (mediaFile.uri) {
          const uri = mediaFile.uri.toLowerCase();
          if (uri.includes('.mp4') || uri.includes('.mov') || uri.includes('.avi')) {
            evidenceType = 'video';
          }
        }
        
        const newEvidence = await db.query(
          `INSERT INTO evidence (
            id,
            report_id,
            evidence_type,
            file_path,
            file_url,
            description,
            submitted_date,
            metadata
          ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, $7) RETURNING *`,
          [
            evidenceId,
            reportId,
            evidenceType,
            mediaFile.title || 'Media File',
            mediaFile.uri || null,
            mediaFile.title || 'Media evidence',
            {
              title: mediaFile.title,
              uri: mediaFile.uri,
              contact_info: contactInfo
            }
          ]
        );
        
        evidenceItems.push(newEvidence.rows[0]);
      }
      
      // Handle uploaded files if any (in addition to URIs)
      if (req.files && req.files.length > 0) {
        for (const file of req.files) {
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
            req.user?.id || null,
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
              submitted_date,
              metadata
            ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, $7) RETURNING *`,
            [
              evidenceId,
              reportId,
              evidenceType,
              file.originalname,
              fileUrl,
              `Uploaded ${evidenceType}: ${file.originalname}`,
              {
                original_name: file.originalname,
                file_size: file.size,
                mime_type: file.mimetype,
                contact_info: contactInfo
              }
            ]
          );
          
          evidenceItems.push(newEvidence.rows[0]);
        }
      }
      
      // Create notification for non-anonymous reports
      if (!anonymous && req.user?.id) {
        await notificationService.createAndSendNotification(
          req.user.id,
          'Report Submitted',
          'Your report has been successfully submitted',
          'report_created',
          'report',
          reportId
        );
      }
      
      // Prepare response
      const responseData = {
        success: true,
        data: {
          report: {
                ...newReport.rows[0],
                 title
               },
          evidence: evidenceItems,
          audio_files_processed: parsedAudioFiles.length,
          images_videos_processed: parsedImagesVideos.length,
          uploaded_files_processed: req.files?.length || 0
        },
        aiAnalysis: aiResult ? {
          suggestedServices: aiResult.suggestedServices,
          recommendations: aiResult.recommendations,
          riskLevel: aiResult.structuredData?.riskLevel
        } : null,
        message: `Report created successfully with ${evidenceItems.length} evidence items`
      };
      
      // Add verification code to response if this is an anonymous report with email
      if (anonymous && email && verificationCode) {
        responseData.verificationInfo = {
          email: email,
          verificationCode: verificationCode,
          message: "Please save this verification code to access your report in the future."
        };
      }
      
      return res.status(201).json(responseData);
    } catch (error) {
      console.error('Error creating report:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error creating report',
        error: error.message
      });
    }
  }

  // ENHANCED: Create audio report (legacy endpoint - redirects to main createReport)
  async createAudioReport(req, res) {
    try {
      // Transform legacy audio format to new array format
      const {
        audio_title,
        audio_transcription,
        contact_info,
        ...otherFields
      } = req.body;
      
      // Create audio_files array from legacy fields
      const audio_files = [];
      if (audio_title || audio_transcription) {
        audio_files.push({
          title: audio_title || 'Audio Report',
          uri: req.body.audio_uri || null,
          transcription: audio_transcription || null
        });
      }
      
      // Extract contact info
      let email = null;
      let phoneNumber = null;
      let address = null;
      
      if (contact_info) {
        // Simple email detection
        if (contact_info.includes('@')) {
          email = contact_info;
        }
        // Simple phone detection
        else if (contact_info.match(/[\d\-\+\(\)\s]+/)) {
          phoneNumber = contact_info;
        } else {
          address = contact_info;
        }
      }
      
      // Transform request
      const transformedBody = {
        ...otherFields,
        audio_files,
        images_videos: [],
        note: req.body.incident_description || audio_transcription,
        email,
        phoneNumber,
        address
      };
      
      // Update request body
      req.body = transformedBody;
      
      // Call main createReport method
      return await this.createReport(req, res);
    } catch (error) {
      console.error('Error creating audio report:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error creating audio report',
        error: error.message
      });
    }
  }

  // Create a new report as a guest user (with array structure)
  async createGuestReport(req, res) {
    try {
      const {
        audio_files,        // Array of {title, uri, transcription}
        images_videos,      // Array of {title, uri}
        note,              // Optional text note
        email,             // Required contact info
        phoneNumber,       // Required contact info  
        address,           // Required contact info
        incident_date,
        incident_type,
        language,
        confidentiality_level
      } = req.body;
      
      // Email is required for guest reports
      if (!email) {
        return res.status(400).json({
          success: false,
          message: 'Email is required for guest reports'
        });
      }
      
      // Parse arrays if they come as strings (from form data)
      let parsedAudioFiles = [];
      let parsedImagesVideos = [];
      
      try {
        parsedAudioFiles = typeof audio_files === 'string' ? JSON.parse(audio_files) : (audio_files || []);
        parsedImagesVideos = typeof images_videos === 'string' ? JSON.parse(images_videos) : (images_videos || []);
      } catch (parseError) {
        console.log('Parse error for arrays, using empty arrays:', parseError.message);
      }
      
      // Generate new UUID for report
      const reportId = uuidv4();
      
      // Process with AI if there's a note or audio transcriptions
      let aiProcessed = false;
      let emotionalContext = null;
      let aiResult = null;
      let processingTime = null;
      
      // Combine text for AI analysis
      let textToAnalyze = note || '';
      if (parsedAudioFiles.length > 0) {
        const transcriptions = parsedAudioFiles
          .filter(audio => audio.transcription)
          .map(audio => audio.transcription)
          .join(' ');
        textToAnalyze += ' ' + transcriptions;
      }
      
      if (textToAnalyze.trim()) {
        // Use enhanced AI service with Llama3
        aiResult = await processWithAI(textToAnalyze.trim(), language || 'en');
        
        if (aiResult) {
          aiProcessed = true;
          emotionalContext = aiResult.emotionalContext || null;
          processingTime = aiResult.processingTime || null;
        }
      }
      
      // Determine incident type from AI if not provided
      const finalIncidentType = incident_type || 
                              (aiResult?.structuredData?.incidentType || 'general incident');
      
      // Create contact info object
      const contactInfo = {
        email: email || null,
        phoneNumber: phoneNumber || null,
        address: address || null
      };

      const title = `Case-${reportId.slice(0, 8)}`;
      
      // Create new report in database - always anonymous for guest reports
      const newReport = await db.query(
        `INSERT INTO reports (
          id, 
          title,
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
          emotional_context,
          contact_info
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
        [
          reportId,
          title,
          null,  // Always null for guest reports
          incident_date || new Date(),
          address ? { address } : {},
          finalIncidentType,
          note || textToAnalyze || 'Guest report with media files',
          language || 'en',
          true,  // Always anonymous for guest reports
          confidentiality_level || 1,
          parsedAudioFiles.length > 0 ? 'audio' : 'mixed',
          aiProcessed,
          emotionalContext,
          contactInfo
        ]
      );
      
      // Record the AI interaction if applicable
      if (aiResult) {
        try {
          await recordInteraction(
            null,  // No user ID for guest reports
            reportId,
            'guest_array_processing',
            textToAnalyze.substring(0, 200),
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
      
      // Create email verification record
      let verificationCode = "12345";  // Fixed code for testing
      
      try {
        // Create verification record
        await db.query(
          `INSERT INTO report_email_verification (
            id, 
            report_id, 
            email, 
            verification_code,
            expires_at
          ) VALUES ($1, $2, $3, $4, $5)`,
          [
            uuidv4(),
            reportId,
            email,
            verificationCode,
            new Date(Date.now() + 1000 * 60 * 60 * 24 * 30) // 30 days expiration
          ]
        );
        
        console.log(`TEST MODE: Using fixed verification code "12345" for ${email}`);
      } catch (verificationError) {
        console.error('Error creating email verification:', verificationError);
        // Continue even if verification creation fails
      }
      
      // Handle audio files array
      const evidenceItems = [];
      for (const audioFile of parsedAudioFiles) {
        const evidenceId = uuidv4();
        
        const newEvidence = await db.query(
          `INSERT INTO evidence (
            id,
            report_id,
            evidence_type,
            file_path,
            file_url,
            description,
            submitted_date,
            metadata
          ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, $7) RETURNING *`,
          [
            evidenceId,
            reportId,
            'audio',
            audioFile.title || 'Audio File',
            audioFile.uri || null,
            audioFile.title || 'Audio evidence',
            {
              title: audioFile.title,
              uri: audioFile.uri,
              transcription: audioFile.transcription,
              contact_info: contactInfo
            }
          ]
        );
        
        evidenceItems.push(newEvidence.rows[0]);
      }
      
      // Handle images/videos array
      for (const mediaFile of parsedImagesVideos) {
        const evidenceId = uuidv4();
        
        // Determine type based on file extension or assume image
        let evidenceType = 'image';
        if (mediaFile.uri) {
          const uri = mediaFile.uri.toLowerCase();
          if (uri.includes('.mp4') || uri.includes('.mov') || uri.includes('.avi')) {
            evidenceType = 'video';
          }
        }
        
        const newEvidence = await db.query(
          `INSERT INTO evidence (
            id,
            report_id,
            evidence_type,
            file_path,
            file_url,
            description,
            submitted_date,
            metadata
          ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, $7) RETURNING *`,
          [
            evidenceId,
            reportId,
            evidenceType,
            mediaFile.title || 'Media File',
            mediaFile.uri || null,
            mediaFile.title || 'Media evidence',
            {
              title: mediaFile.title,
              uri: mediaFile.uri,
              contact_info: contactInfo
            }
          ]
        );
        
        evidenceItems.push(newEvidence.rows[0]);
      }
      
      // Handle uploaded files if any (in addition to URIs)
      if (req.files && req.files.length > 0) {
        for (const file of req.files) {
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
          
          // Upload file to cloud storage - use null for user_id
          const fileUrl = await storageService.uploadFile(
            file,
            null,  // No user ID for guest reports
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
              submitted_date,
              metadata
            ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, $7) RETURNING *`,
            [
              evidenceId,
              reportId,
              evidenceType,
              file.originalname,
              fileUrl,
              `Uploaded ${evidenceType}: ${file.originalname}`,
              {
                original_name: file.originalname,
                file_size: file.size,
                mime_type: file.mimetype,
                contact_info: contactInfo
              }
            ]
          );
          
          evidenceItems.push(newEvidence.rows[0]);
        }
      }
      
      // Prepare response
      const responseData = {
        success: true,
        data: {
          report: {
               ...newReport.rows[0],
               title
             },
          evidence: evidenceItems,
          audio_files_processed: parsedAudioFiles.length,
          images_videos_processed: parsedImagesVideos.length,
          uploaded_files_processed: req.files?.length || 0
        },
        aiAnalysis: aiResult ? {
          suggestedServices: aiResult.suggestedServices,
          recommendations: aiResult.recommendations,
          riskLevel: aiResult.structuredData?.riskLevel
        } : null,
        verificationInfo: {
          email: email,
          verificationCode: verificationCode,
          message: "Please save this verification code to access your report in the future.",
          accessUrl: `/api/v1/reports/guest/email/${email}?code=${verificationCode}`
        },
        message: `Guest report created successfully with ${evidenceItems.length} evidence items`
      };
      
      return res.status(201).json(responseData);
    } catch (error) {
      console.error('Error creating guest report:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error creating guest report',
        error: error.message
      });
    }
  }

  async getDashboardStats(req, res) {
    try {
      const [users, totalReports, pendingReports, completedReports] = await Promise.all([
        db.query('SELECT COUNT(*) FROM users'),
        db.query('SELECT COUNT(*) FROM reports'),
        db.query("SELECT COUNT(*) FROM reports WHERE status = 'pending'"),
        db.query("SELECT COUNT(*) FROM reports WHERE status = 'completed'")
      ]);
  
      return res.status(200).json({
        success: true,
        data: {
          total_users: parseInt(users.rows[0].count),
          total_reports: parseInt(totalReports.rows[0].count),
          pending_reports: parseInt(pendingReports.rows[0].count),
          completed_reports: parseInt(completedReports.rows[0].count)
        }
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Dashboard error' });
    }
  }  

  // Get reports by email for guest users
  async getGuestReportsByEmail(req, res) {
    try {
      const email = req.params.email;
      const emailVerificationCode = req.query.code;
      
      // Check if verification code is provided
      if (!emailVerificationCode) {
        return res.status(400).json({
          success: false,
          message: 'Verification code is required'
        });
      }
      
      // SIMPLIFIED FOR TESTING: Allow "12345" as a universal code
      if (emailVerificationCode === "12345") {
        // Find reports associated with this email
        const reports = await db.query(
          `SELECT r.* FROM reports r
           JOIN report_email_verification v ON r.id = v.report_id
           WHERE v.email = $1
           ORDER BY r.created_at DESC`,
          [email]
        );
        
        // Also include evidence with each report
        if (reports.rows.length > 0) {
          // Fetch evidence for each report
          for (let i = 0; i < reports.rows.length; i++) {
            const evidence = await db.query(
              'SELECT * FROM evidence WHERE report_id = $1',
              [reports.rows[i].id]
            );
            reports.rows[i].evidence = evidence.rows;
          }
        }
        
        return res.status(200).json({
          success: true,
          count: reports.rows.length,
          data: reports.rows
        });
      }
      
      // If not using the test code, proceed with normal verification
      const reports = await db.query(
        `SELECT r.* FROM reports r
         JOIN report_email_verification v ON r.id = v.report_id
         WHERE v.email = $1 AND v.verification_code = $2
         ORDER BY r.created_at DESC`,
        [email, emailVerificationCode]
      );
      
      // Include evidence with each report
      if (reports.rows.length > 0) {
        for (let i = 0; i < reports.rows.length; i++) {
          const evidence = await db.query(
            'SELECT * FROM evidence WHERE report_id = $1',
            [reports.rows[i].id]
          );
          reports.rows[i].evidence = evidence.rows;
        }
      }
      
      return res.status(200).json({
        success: true,
        count: reports.rows.length,
        data: reports.rows
      });
    } catch (error) {
      console.error('Error fetching guest reports by email:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error retrieving reports',
        error: error.message
      });
    }
  }

  // Public access: read-only report info
  async getPublicReportById(req, res) {
    try {
      const reportId = req.params.id;
      const report = await db.query(
        'SELECT id, title, incident_type, incident_description, report_date, location_data FROM reports WHERE id = $1',
        [reportId]
      );

      if (report.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Report not found' });
      }

      return res.status(200).json({ success: true, data: report.rows[0] });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: 'Error retrieving report' });
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
      await db.query('DELETE FROM report_email_verification WHERE report_id = $1', [reportId]);
      
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
}

module.exports = new ReportController();