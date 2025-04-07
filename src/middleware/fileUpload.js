// In fileUpload.js middleware
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Define the upload directory using an absolute path
const uploadsDir = path.join(__dirname, '../uploads');

// Ensure uploads directory exists
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure storage with absolute path
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function(req, file, cb) {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

// File filter
const fileFilter = (req, file, cb) => {
  // Accept images, audio, video, and documents
  if (
    file.mimetype.startsWith('image/') ||
    file.mimetype.startsWith('audio/') ||
    file.mimetype.startsWith('video/') ||
    file.mimetype.startsWith('application/')
  ) {
    cb(null, true);
  } else {
    cb(new Error('Unsupported file type'), false);
  }
};

// Export middleware - with options for single or multiple files
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

module.exports = {
  single: (req, res, next) => {
    console.log('Single file upload middleware called');
    upload.single('file')(req, res, (err) => {
      if (err) {
        console.error('File upload error:', err);
        return res.status(400).json({
          success: false,
          message: 'File upload error',
          error: err.message
        });
      }
      console.log('Single file upload successful');
      next();
    });
  },
  multiple: (req, res, next) => {
    console.log('Multiple file upload middleware called');
    upload.array('files', 10)(req, res, (err) => {
      if (err) {
        console.error('Multiple file upload error:', err);
        return res.status(400).json({
          success: false,
          message: 'File upload error',
          error: err.message
        });
      }
      console.log('Multiple file upload successful, files:', req.files?.length);
      next();
    });
  }
};