// src/middleware/optimizedFileUpload.js
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// Configure storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    let uploadPath = path.join(__dirname, '../uploads/');
        
    if (file.mimetype.startsWith('image/')) {
      uploadPath = path.join(uploadPath, 'images/');
    } else if (file.mimetype.startsWith('audio/')) {
      uploadPath = path.join(uploadPath, 'audio/');
    } else if (file.mimetype.startsWith('video/')) {
      uploadPath = path.join(uploadPath, 'video/');
    } else {
      uploadPath = path.join(uploadPath, 'documents/');
    }
        
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
        
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = uuidv4();
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// Enhanced file filter with better validation
const fileFilter = (req, file, cb) => {
  console.log(`Processing file: ${file.originalname}, type: ${file.mimetype}`);
  
  if (file.fieldname === 'audioFile') {
    // Only accept audio files for audioFile field
    if (file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed for voice reports'), false);
    }
  } else if (file.fieldname === 'file') {
    // Accept common file types for evidence
    const allowedMimeTypes = [
      // Images
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 
      'image/webp', 'image/bmp', 'image/tiff',
      // Audio
      'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 
      'audio/aac', 'audio/flac', 'audio/m4a',
      // Video
      'video/mp4', 'video/webm', 'video/avi', 'video/mov', 
      'video/wmv', 'video/flv', 'video/mkv',
      // Documents
      'application/pdf', 'application/msword', 
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain', 'text/csv'
    ];
        
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} is not allowed`), false);
    }
  } else {
    // Default case - accept the file
    cb(null, true);
  }
};

// Function to get file size limit based on type
const getFileSizeLimit = (file) => {
  if (file.mimetype.startsWith('image/')) {
    return 25 * 1024 * 1024; // 25MB for images
  } else if (file.mimetype.startsWith('audio/')) {
    return 200 * 1024 * 1024; // 200MB for audio
  } else if (file.mimetype.startsWith('video/')) {
    return 1024 * 1024 * 1024; // 1GB for video
  } else {
    return 50 * 1024 * 1024; // 50MB for documents
  }
};

// Custom file size validation
const customFileSizeValidation = (req, file, cb) => {
  // This is called before the file is fully uploaded
  // We'll do the actual size check in the middleware
  cb(null, true);
};

// Different upload configurations for different file types
const imageUpload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB for images
  }
});

const audioUpload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed'), false);
    }
  },
  limits: {
    fileSize: 200 * 1024 * 1024 // 200MB for audio
  }
});

const videoUpload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only video files are allowed'), false);
    }
  },
  limits: {
    fileSize: 1024 * 1024 * 1024 // 1GB for video
  }
});

const documentUpload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB for documents
  }
});

// Smart upload that chooses limits based on file type
const smartUpload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 500 * 1024 * 1024 // Set to maximum (500MB), we'll validate per type
  }
});

// Enhanced error handling middleware
const handleUploadError = (err, req, res, next) => {
  console.error('Upload error:', err);
  
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      // Determine what the limit should have been
      let limitMessage = 'File too large';
      if (req.file) {
        const file = req.file;
        if (file.mimetype.startsWith('image/')) {
          limitMessage = 'Image files must be under 25MB';
        } else if (file.mimetype.startsWith('audio/')) {
          limitMessage = 'Audio files must be under 200MB';
        } else if (file.mimetype.startsWith('video/')) {
          limitMessage = 'Video files must be under 1GB';
        } else {
          limitMessage = 'Document files must be under 50MB';
        }
      }
      
      return res.status(413).json({
        success: false,
        message: limitMessage,
        error: 'FILE_TOO_LARGE'
      });
    }
    
    return res.status(400).json({
      success: false,
      message: `Upload error: ${err.message}`,
      error: err.code
    });
  } else if (err) {
    return res.status(400).json({
      success: false,
      message: err.message,
      error: 'UPLOAD_ERROR'
    });
  }
  
  next();
};

// Middleware to validate file size after upload based on type
const validateFileSize = (req, res, next) => {
  if (req.file) {
    const file = req.file;
    const maxSize = getFileSizeLimit(file);
    
    if (file.size > maxSize) {
      // Clean up the uploaded file
      try {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      } catch (cleanupError) {
        console.error('Failed to cleanup oversized file:', cleanupError);
      }
      
      const sizeMB = Math.round(maxSize / (1024 * 1024));
      let fileType = 'File';
      if (file.mimetype.startsWith('image/')) fileType = 'Image';
      else if (file.mimetype.startsWith('audio/')) fileType = 'Audio';
      else if (file.mimetype.startsWith('video/')) fileType = 'Video';
      else fileType = 'Document';
      
      return res.status(413).json({
        success: false,
        message: `${fileType} files must be under ${sizeMB}MB`,
        error: 'FILE_TOO_LARGE'
      });
    }
  }
  
  next();
};

module.exports = {
  imageUpload,
  audioUpload, 
  videoUpload,
  documentUpload,
  smartUpload,
  handleUploadError,
  validateFileSize,
  
  // Convenience methods
  single: (fieldName = 'file') => {
    return [
      smartUpload.single(fieldName),
      validateFileSize,
      handleUploadError
    ];
  },
  
  multiple: (fieldName = 'files', maxCount = 10) => {
    return [
      smartUpload.array(fieldName, maxCount),
      validateFileSize,
      handleUploadError
    ];
  }
};