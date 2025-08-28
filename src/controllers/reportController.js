const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const { processWithAI, recordInteraction } = require('../services/enhancedAiService');
const notificationService = require('../services/notificationService');
const storageService = require('../services/storageService');
const evidenceController = require('./evidenceController');

class ReportController {
  

// Fixed getReportById method with agency user access
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
    
    // ENHANCED: Check permissions - now includes agency users
    let hasPermission = false;
    
    // Admin can view all reports
    if (req.user.is_admin) {
      hasPermission = true;
    }
    // Report owner can view their own report
    else if (req.user.id === report.rows[0].user_id) {
      hasPermission = true;
    }
    // Agency users can view reports referred to their agency
    else if (req.user.is_agency_user) {
      // Check if this report is referred to the user's agency
      const userAgency = await db.query(
        'SELECT agency_id FROM agency_contacts WHERE user_id = $1',
        [req.user.id]
      );
      
      if (userAgency.rows.length > 0) {
        const referralCheck = await db.query(
          'SELECT id FROM referrals WHERE report_id = $1 AND agency_id = $2',
          [reportId, userAgency.rows[0].agency_id]
        );
        
        if (referralCheck.rows.length > 0) {
          hasPermission = true;
        }
      }
    }
    
    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view this report'
      });
    }
    
    // Get evidence
    const evidenceResult = await db.query(
      'SELECT * FROM evidence WHERE report_id = $1 ORDER BY submitted_date DESC',
      [reportId]
    );
    
    // Process each evidence item to generate URLs if files exist
    const processedEvidence = await Promise.all(
      evidenceResult.rows.map(async (evidence) => {
        if (evidence.file_url) {
          try {
            // Try to generate signed URL
            const signedUrl = await storageService.getSignedUrl(evidence.file_url);
            return {
              ...evidence,
              viewUrl: signedUrl,
              downloadUrl: signedUrl,
              error: null
            };
          } catch (storageError) {
            // File doesn't exist - return evidence data with error
            return {
              ...evidence,
              viewUrl: null,
              downloadUrl: null,
              error: "File not found"
            };
          }
        } else {
          // No file URL - likely a URI-only evidence
          return {
            ...evidence,
            viewUrl: evidence.metadata?.uri || null,
            downloadUrl: null,
            error: evidence.metadata?.uri ? null : "File not found"
          };
        }
      })
    );
    
    // Organize evidence by type
    const organizedEvidence = {
      audios: processedEvidence.filter(e => e.evidence_type === 'audio'),
      images: processedEvidence.filter(e => e.evidence_type === 'image'),
      videos: processedEvidence.filter(e => e.evidence_type === 'video'),
      documents: processedEvidence.filter(e => e.evidence_type === 'document')
    };

    return res.status(200).json({
      success: true,
      data: {
        ...report.rows[0],
        evidence: organizedEvidence,
        evidenceSummary: {
          total: processedEvidence.length,
          images: organizedEvidence.images.length,
          audios: organizedEvidence.audios.length,
          videos: organizedEvidence.videos.length,
          documents: organizedEvidence.documents.length
        }
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

// Fixed createReport method with proper metadata (no contact info in evidence metadata)
async createReport(req, res) {
  try {
    const {
      audio_files,        
      images_videos,      
      note,              
      email,             
      phoneNumber,       
      address,           
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
    
    // Create email verification for anonymous reports with random 5-digit token
    let verificationCode = null;
    if (anonymous && email) {
      try {
        // Generate random 5-digit verification code
        verificationCode = Math.floor(10000 + Math.random() * 90000).toString();
        
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
        
        console.log(`Generated verification code "${verificationCode}" for ${email}`);
      } catch (verificationError) {
        console.error('Error creating email verification:', verificationError);
        // Continue even if verification creation fails
      }
    }
    
    // Handle audio files array - FIXED metadata
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
            source_type: 'uri_provided'
          }
        ]
      );
      
      evidenceItems.push(newEvidence.rows[0]);
    }
    
    // Handle images/videos array - FIXED metadata
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
            source_type: 'uri_provided'
          }
        ]
      );
      
      evidenceItems.push(newEvidence.rows[0]);
    }
    
    // Handle uploaded files if any - FIXED metadata
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
              upload_timestamp: new Date().toISOString(),
              source_type: 'file_upload'
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
        message: "Please save this 5-digit code to access your report in the future.",
        accessInstructions: "Visit our website and use 'Check Report Status' with your email and this code"
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

// Fixed createGuestReport method with proper metadata (no contact info in evidence metadata)
async createGuestReport(req, res) {
  try {
    console.log('DEBUG - Full request body:', req.body);
    
    const {
      audio_files,        
      images_videos,      
      note,              
      email,             
      phoneNumber: phoneNumberCamel,    
      phone_number: phoneNumberSnake,   
      address,           
      incident_date,
      incident_type,
      language,
      confidentiality_level
    } = req.body;

    const phoneNumber = phoneNumberCamel || phoneNumberSnake;
    
    console.log('DEBUG - Destructured values:', {
      email,
      phoneNumber,
      address
    });
    
    if (!email && !phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Either email or phone number is required for guest reports'
      });
    }
    
    let parsedAudioFiles = [];
    let parsedImagesVideos = [];
    
    try {
      parsedAudioFiles = typeof audio_files === 'string' ? JSON.parse(audio_files) : (audio_files || []);
      parsedImagesVideos = typeof images_videos === 'string' ? JSON.parse(images_videos) : (images_videos || []);
    } catch (parseError) {
      console.log('Parse error for arrays, using empty arrays:', parseError.message);
    }
    
    const reportId = uuidv4();
    
    // AI processing (same as before)
    let aiProcessed = false;
    let emotionalContext = null;
    let aiResult = null;
    let processingTime = null;
    
    let textToAnalyze = note || '';
    if (parsedAudioFiles.length > 0) {
      const transcriptions = parsedAudioFiles
        .filter(audio => audio.transcription)
        .map(audio => audio.transcription)
        .join(' ');
      textToAnalyze += ' ' + transcriptions;
    }
    
    if (textToAnalyze.trim()) {
      aiResult = await processWithAI(textToAnalyze.trim(), language || 'en');
      
      if (aiResult) {
        aiProcessed = true;
        emotionalContext = aiResult.emotionalContext || null;
        processingTime = aiResult.processingTime || null;
      }
    }
    
    const finalIncidentType = incident_type || 
                            (aiResult?.structuredData?.incidentType || 'general incident');
    
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
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
      [
        reportId,
        title,
        null,  
        incident_date || new Date(),
        address ? { address } : {},
        finalIncidentType,
        note || textToAnalyze || 'Guest report with media files',
        language || 'en',
        true,  
        confidentiality_level || 1,
        parsedAudioFiles.length > 0 ? 'audio' : 'mixed',
        aiProcessed,
        emotionalContext,
        contactInfo
      ]
    );
    
    // Record AI interaction if applicable (same as before)
    if (aiResult) {
      try {
        await recordInteraction(
          null,  
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
      }
    }
    
    // Generate verification code
    let verificationCode = Math.floor(10000 + Math.random() * 90000).toString();

    try {
      await db.query(
        `INSERT INTO report_email_verification (
          id, 
          report_id, 
          email, 
          phone_number,
          verification_code,
          expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          uuidv4(),
          reportId,
          email || null,
          phoneNumber || null,  
          verificationCode,
          new Date(Date.now() + 1000 * 60 * 60 * 24 * 30)
        ]
      );
      
      console.log(`Generated verification code "${verificationCode}" for ${email || phoneNumber}`);
    } catch (verificationError) {
      console.error('Error creating email verification:', verificationError);
    }
    
    // Handle audio files - FIXED metadata
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
            source_type: 'uri_provided'
          }
        ]
      );
      
      evidenceItems.push(newEvidence.rows[0]);
    }
    
    // Handle images/videos - FIXED metadata
    for (const mediaFile of parsedImagesVideos) {
      const evidenceId = uuidv4();
      
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
            source_type: 'uri_provided'
          }
        ]
      );
      
      evidenceItems.push(newEvidence.rows[0]);
    }
    
    // Handle uploaded files - FIXED metadata
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const evidenceId = uuidv4();
        
        let evidenceType = 'document';
        if (file.mimetype.startsWith('image/')) {
          evidenceType = 'image';
        } else if (file.mimetype.startsWith('audio/')) {
          evidenceType = 'audio';
        } else if (file.mimetype.startsWith('video/')) {
          evidenceType = 'video';
        }
        
        const fileUrl = await storageService.uploadFile(
          file,
          null,  
          reportId,
          evidenceType
        );
        
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
              upload_timestamp: new Date().toISOString(),
              source_type: 'file_upload'
            }
          ]
        );
        
        evidenceItems.push(newEvidence.rows[0]);
      }
    }
    
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
        contact: email || phoneNumber,
        verificationCode: verificationCode,
        message: "Please save this 5-digit code to access your report in the future.",
        accessInstructions: `Use the code ${verificationCode} to access your report.`
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

// Enhanced getAllReports method with advanced filtering
async getAllReports(req, res) {
  try {
    const { 
      page = 1, 
      limit = 10, 
      status, 
      incident_type,
      date_range, // New: 7days, 30days, 90days, thisyear
      start_date, // New: Custom date range start
      end_date,   // New: Custom date range end
      search      // New: Search by title or description
    } = req.query;
    
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
    
    // Add status filter
    if (status) {
      conditions.push('status = $' + (queryParams.length + 1));
      queryParams.push(status);
    }
    
    // Add incident type filter
    if (incident_type) {
      conditions.push('incident_type = $' + (queryParams.length + 1));
      queryParams.push(incident_type);
    }
    
    // Add date range filtering
    if (date_range) {
      let dateCondition = '';
      const now = new Date();
      
      switch (date_range) {
        case '7days':
          const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          dateCondition = 'created_at >= $' + (queryParams.length + 1);
          queryParams.push(sevenDaysAgo.toISOString());
          break;
          
        case '30days':
          const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          dateCondition = 'created_at >= $' + (queryParams.length + 1);
          queryParams.push(thirtyDaysAgo.toISOString());
          break;
          
        case '90days':
          const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
          dateCondition = 'created_at >= $' + (queryParams.length + 1);
          queryParams.push(ninetyDaysAgo.toISOString());
          break;
          
        case 'thisyear':
          const yearStart = new Date(now.getFullYear(), 0, 1);
          dateCondition = 'created_at >= $' + (queryParams.length + 1);
          queryParams.push(yearStart.toISOString());
          break;
          
        default:
          // Invalid date_range value, ignore
          break;
      }
      
      if (dateCondition) {
        conditions.push(dateCondition);
      }
    }
    
    // Add custom date range filtering (overrides date_range if both provided)
    if (start_date || end_date) {
      if (start_date) {
        conditions.push('created_at >= $' + (queryParams.length + 1));
        queryParams.push(new Date(start_date).toISOString());
      }
      if (end_date) {
        // Add one day to end_date to include the entire end date
        const endDateTime = new Date(end_date);
        endDateTime.setDate(endDateTime.getDate() + 1);
        conditions.push('created_at < $' + (queryParams.length + 1));
        queryParams.push(endDateTime.toISOString());
      }
    }
    
    // Add search functionality (search in title and incident_description)
    if (search) {
      const searchTerm = `%${search.trim()}%`;
      conditions.push(
        '(title ILIKE $' + (queryParams.length + 1) + 
        ' OR incident_description ILIKE $' + (queryParams.length + 2) + ')'
      );
      queryParams.push(searchTerm, searchTerm);
    }
    
    // Add WHERE clause if conditions exist
    if (conditions.length > 0) {
      const whereClause = ' WHERE ' + conditions.join(' AND ');
      query += whereClause;
      countQuery += whereClause;
    }
    
    // Add pagination
    query += ' ORDER BY created_at DESC LIMIT $' + (queryParams.length + 1) + ' OFFSET $' + (queryParams.length + 2);
    const paginationParams = [...queryParams, limit, offset];
    
    // Execute queries
    const [reports, totalCount] = await Promise.all([
      db.query(query, paginationParams),
      db.query(countQuery, queryParams)
    ]);
    
    // Get evidence summaries for all reports
    const reportIds = reports.rows.map(report => report.id);
    let reportsWithEvidence = reports.rows;
    
    if (reportIds.length > 0) {
      // Get evidence counts for each report
      const evidenceQuery = `
        SELECT 
          report_id,
          evidence_type,
          COUNT(*) as count
        FROM evidence 
        WHERE report_id = ANY($1)
        GROUP BY report_id, evidence_type
      `;
      
      const evidenceResult = await db.query(evidenceQuery, [reportIds]);
      
      // Build evidence summary for each report
      const evidenceSummaries = {};
      
      // Initialize summaries
      reportIds.forEach(reportId => {
        evidenceSummaries[reportId] = { 
          total: 0, images: 0, audios: 0, videos: 0, documents: 0 
        };
      });
      
      // Populate summaries from query results
      evidenceResult.rows.forEach(row => {
        const { report_id, evidence_type, count } = row;
        const numCount = parseInt(count);
        evidenceSummaries[report_id].total += numCount;
        
        if (evidence_type === 'image') {
          evidenceSummaries[report_id].images = numCount;
        } else if (evidence_type === 'audio') {
          evidenceSummaries[report_id].audios = numCount;
        } else if (evidence_type === 'video') {
          evidenceSummaries[report_id].videos = numCount;
        } else {
          evidenceSummaries[report_id].documents = numCount;
        }
      });
      
      // Add evidence summaries to reports
      reportsWithEvidence = reports.rows.map(report => ({
        ...report,
        evidenceSummary: evidenceSummaries[report.id] || { 
          total: 0, images: 0, audios: 0, videos: 0, documents: 0 
        }
      }));
    }
    
    return res.status(200).json({
      success: true,
      data: reportsWithEvidence,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(totalCount.rows[0].count),
        pages: Math.ceil(totalCount.rows[0].count / limit)
      },
      filters: {
        status: status || null,
        incident_type: incident_type || null,
        date_range: date_range || null,
        start_date: start_date || null,
        end_date: end_date || null,
        search: search || null
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


// Get reports by verification token only (no email needed) - with organized evidence
async getGuestReportsByToken(req, res) {
  try {
    const verificationCode = req.params.token;
    
    // Check if verification code is provided
    if (!verificationCode) {
      return res.status(400).json({
        success: false,
        message: 'Verification code is required'
      });
    }
    
    // Validate verification code format (should be 5 digits)
    if (!/^\d{5}$/.test(verificationCode)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid verification code format. Please provide a 5-digit code.'
      });
    }
    
    // Find reports with matching verification code (no email needed)
    const reports = await db.query(
      `SELECT r.* FROM reports r
       JOIN report_email_verification v ON r.id = v.report_id
       WHERE v.verification_code = $1 AND v.expires_at > NOW()
       ORDER BY r.created_at DESC`,
      [verificationCode]
    );
    
    if (reports.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No reports found with this verification code, or the code has expired.'
      });
    }
    
    // Process each report to organize evidence by type
    for (let i = 0; i < reports.rows.length; i++) {
      const evidenceResult = await db.query(
        'SELECT * FROM evidence WHERE report_id = $1 ORDER BY submitted_date DESC',
        [reports.rows[i].id]
      );
      
      // Process each evidence item to generate URLs if files exist
      const processedEvidence = await Promise.all(
        evidenceResult.rows.map(async (evidence) => {
          if (evidence.file_url) {
            try {
              // Try to generate signed URL
              const signedUrl = await storageService.getSignedUrl(evidence.file_url);
              return {
                ...evidence,
                viewUrl: signedUrl,
                downloadUrl: signedUrl,
                error: null
              };
            } catch (storageError) {
              // File doesn't exist - return evidence data with error
              return {
                ...evidence,
                viewUrl: null,
                downloadUrl: null,
                error: "File not found"
              };
            }
          } else {
            // No file URL - likely a URI-only evidence
            return {
              ...evidence,
              viewUrl: evidence.metadata?.uri || null,
              downloadUrl: null,
              error: evidence.metadata?.uri ? null : "File not found"
            };
          }
        })
      );
      
      // Organize evidence by type
      const organizedEvidence = {
        audios: processedEvidence.filter(e => e.evidence_type === 'audio'),
        images: processedEvidence.filter(e => e.evidence_type === 'image'),
        videos: processedEvidence.filter(e => e.evidence_type === 'video'),
        documents: processedEvidence.filter(e => e.evidence_type === 'document')
      };
      
      // Add organized evidence and summary to report
      reports.rows[i].evidence = organizedEvidence;
      reports.rows[i].evidenceSummary = {
        total: processedEvidence.length,
        images: organizedEvidence.images.length,
        audios: organizedEvidence.audios.length,
        videos: organizedEvidence.videos.length,
        documents: organizedEvidence.documents.length
      };
    }
    
    return res.status(200).json({
      success: true,
      count: reports.rows.length,
      data: reports.rows,
      message: `Found ${reports.rows.length} report(s) with verification code`
    });
  } catch (error) {
    console.error('Error fetching guest reports by token:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error retrieving reports',
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
    
    // Validate verification code format (should be 5 digits)
    if (!/^\d{5}$/.test(emailVerificationCode)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid verification code format. Please provide a 5-digit code.'
      });
    }
    
    // Find reports with matching email and verification code
    const reports = await db.query(
      `SELECT r.* FROM reports r
       JOIN report_email_verification v ON r.id = v.report_id
       WHERE v.email = $1 AND v.verification_code = $2 AND v.expires_at > NOW()
       ORDER BY r.created_at DESC`,
      [email, emailVerificationCode]
    );
    
    if (reports.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No reports found with this email and verification code, or the code has expired.'
      });
    }
    
    // Include evidence with each report
    for (let i = 0; i < reports.rows.length; i++) {
      const evidence = await db.query(
        'SELECT * FROM evidence WHERE report_id = $1',
        [reports.rows[i].id]
      );
      reports.rows[i].evidence = evidence.rows;
    }
    
    return res.status(200).json({
      success: true,
      count: reports.rows.length,
      data: reports.rows,
      message: `Found ${reports.rows.length} report(s) for ${email}`
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

// Get latest 100 reports referred to agencies (for admin and agency users)
async getLatestReferredReports(req, res) {
  try {
    let query = `
      SELECT 
        r.*,
        ref.id as referral_id,
        ref.referral_date,
        ref.referral_status,
        ref.notes as referral_notes,
        a.id as agency_id,
        a.name as agency_name,
        a.status as agency_status
      FROM reports r
      INNER JOIN referrals ref ON r.id = ref.report_id
      LEFT JOIN agencies a ON ref.agency_id = a.id`;

    let queryParams = [];
    let whereClause = '';

    // If user is agency user (not admin), filter by their agency
    if (req.user.is_agency_user && !req.user.is_admin) {
      // Get the agency ID for this user
      const userAgency = await db.query(
        'SELECT agency_id FROM agency_contacts WHERE user_id = $1',
        [req.user.id]
      );

      if (userAgency.rows.length === 0) {
        return res.status(403).json({
          success: false,
          message: 'Agency user not associated with any agency'
        });
      }

      whereClause = ' WHERE ref.agency_id = $1';
      queryParams.push(userAgency.rows[0].agency_id);
    }

    // Complete the query
    query += whereClause + ' ORDER BY ref.referral_date DESC LIMIT 100';

    const result = await db.query(query, queryParams);

    // Get evidence summaries for all reports
    const reportIds = result.rows.map(report => report.id);
    let reportsWithEvidence = result.rows;
    
    if (reportIds.length > 0) {
      // Get evidence counts for each report
      const evidenceQuery = `
        SELECT 
          report_id,
          evidence_type,
          COUNT(*) as count
        FROM evidence 
        WHERE report_id = ANY($1)
        GROUP BY report_id, evidence_type
      `;
      
      const evidenceResult = await db.query(evidenceQuery, [reportIds]);
      
      // Build evidence summary for each report
      const evidenceSummaries = {};
      
      // Initialize summaries
      reportIds.forEach(reportId => {
        evidenceSummaries[reportId] = { 
          total: 0, images: 0, audios: 0, videos: 0, documents: 0 
        };
      });
      
      // Populate summaries from query results
      evidenceResult.rows.forEach(row => {
        const { report_id, evidence_type, count } = row;
        const numCount = parseInt(count);
        evidenceSummaries[report_id].total += numCount;
        
        if (evidence_type === 'image') {
          evidenceSummaries[report_id].images = numCount;
        } else if (evidence_type === 'audio') {
          evidenceSummaries[report_id].audios = numCount;
        } else if (evidence_type === 'video') {
          evidenceSummaries[report_id].videos = numCount;
        } else {
          evidenceSummaries[report_id].documents = numCount;
        }
      });
      
      // Add evidence summaries to reports
      reportsWithEvidence = result.rows.map(report => ({
        ...report,
        evidenceSummary: evidenceSummaries[report.id] || { 
          total: 0, images: 0, audios: 0, videos: 0, documents: 0 
        }
      }));
    }

    const userType = req.user.is_admin ? 'admin' : 'agency user';
    const scopeMessage = req.user.is_admin ? 
      'all agencies' : 
      `agency: ${result.rows.length > 0 ? result.rows[0].agency_name : 'your agency'}`;

    return res.status(200).json({
      success: true,
      count: result.rows.length,
      data: reportsWithEvidence,
      userType,
      scope: scopeMessage,
      message: `Retrieved ${result.rows.length} latest referred reports for ${scopeMessage}`
    });

  } catch (error) {
    console.error('Error fetching latest referred reports:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error fetching latest referred reports',
      error: error.message
    });
  }
}

  // NEW: Get the latest 100 reports (for overview/dashboard)
  async getLatestReports(req, res) {
    try {
      const result = await db.query(`
        SELECT * FROM reports 
        ORDER BY created_at DESC
        LIMIT 100
      `);

      return res.status(200).json({
        success: true,
        count: result.rows.length,
        data: result.rows
      });
    } catch (error) {
      console.error('Error fetching latest reports:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error fetching latest reports',
        error: error.message
      });
    }
  }
  
// Updated updateReportStatus method in ReportController.js

async updateReportStatus(req, res) {
  try {
    const reportId = req.params.id;
    let { status } = req.body;
    
    // Normalize the status (trim whitespace and convert to lowercase)
    status = status?.toString().trim().toLowerCase();
    
    // Define valid statuses (all lowercase for comparison) - UPDATED to use "processing"
    const validStatuses = [
      'submitted', 
      'processing',      // Changed from 'in_progress'
      'under_review', 
      'resolving',       // Changed from 'in_progress'
      'completed',       // Changed from 'resolved'
      'archived',
      'pending',        // Add common alternative
      'open'           // Add common alternative
    ];
    
    // Map common alternatives to your standard statuses
    const statusMappings = {
      'pending': 'submitted',
      'in_progress': 'processing',  // Map old status to new one
      'resolved': 'completed',      // Map old status to new one
      'closed': 'completed',        // Map closed to completed
      'open': 'submitted'
    };
    
    // Apply mapping if needed
    const mappedStatus = statusMappings[status] || status;
    
    if (!validStatuses.includes(status) && !validStatuses.includes(mappedStatus)) {
      console.log('Invalid status received:', req.body.status); // Debug log
      return res.status(400).json({
        success: false,
        message: `Invalid status "${req.body.status}". Status must be one of: submitted, processing, under_review, resolving, completed, archived`
      });
    }
    
    const finalStatus = mappedStatus;
    
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
      [finalStatus, reportId]
    );
    
    // Send notification if user isn't anonymous and status has changed
    if (existingReport.rows[0].user_id && finalStatus !== existingReport.rows[0].status) {
      await notificationService.sendReportStatusNotification(
        existingReport.rows[0].user_id,
        reportId,
        finalStatus
      );
    }
    
    return res.status(200).json({
      success: true,
      data: updatedReport.rows[0],
      message: `Report status updated to "${finalStatus}" successfully`
    });
  } catch (error) {
    console.error('Error updating report status:', error);
    console.error('Request body:', req.body); // Debug log
    return res.status(500).json({
      success: false,
      message: 'Server error updating report status',
      error: error.message
    });
  }
}


}

module.exports = new ReportController();