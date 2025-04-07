// In fileUpload.js middleware
const multer = require('multer');
const path = require('path');

// Configure storage
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    cb(null, 'uploads/');
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
  single: upload.single('file'),
  multiple: upload.array('files', 10) // Allow up to 10 files
};