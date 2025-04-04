// In src/services/storageService.js

const { Storage } = require('@google-cloud/storage');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Initialize storage with proper credential handling
let storage;

if (process.env.NODE_ENV === 'production' && process.env.GOOGLE_CREDENTIALS_JSON) {
  // Parse the credentials JSON from the environment variable
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
  
  // Use directly with the Google Cloud library
  storage = new Storage({
    projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
    credentials: credentials
  });
} else {
  // Use local credentials file for development
  storage = new Storage({
    projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
    keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
  });
}

const bucketName = process.env.GOOGLE_CLOUD_BUCKET_NAME;
const bucket = storage.bucket(bucketName);

/**
 * Upload file to Google Cloud Storage
 * @param {Object} file - File object (from multer)
 * @param {String} userId - User ID
 * @param {String} reportId - Report ID
 * @param {String} evidenceType - Type of evidence (image, video, audio, document)
 * @returns {Promise<String>} - GCS URI of the uploaded file
 */
const uploadFile = async (file, userId, reportId, evidenceType) => {
  // Create folder structure: userId/reportId/evidenceType/
  const fileName = `${userId}/${reportId}/${evidenceType}/${Date.now()}-${file.originalname}`;
  const fileUpload = bucket.file(fileName);
  
  // Debug the file object
    console.log('File details:', {
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        buffer: file.buffer ? `Buffer exists (${file.buffer.length} bytes)` : 'No buffer found'
    });
  
  const blobStream = fileUpload.createWriteStream({
    metadata: {
      contentType: file.mimetype,
      metadata: {
        userId: userId,
        reportId: reportId,
        originalName: file.originalname,
        fileSize: file.size,
      }
    },
    resumable: false // Set to true for files > 5MB
  });

  return new Promise((resolve, reject) => {
    blobStream.on('error', (error) => {
      console.error('Upload error:', error);
      reject(error);
    });
    
    blobStream.on('finish', async () => {
      try {
        // Get the file's GCS URI
        const fileUri = `gs://${bucket.name}/${fileUpload.name}`;
        resolve(fileUri); // Just return the GCS URI as a string
      } catch (error) {
        reject(error);
      }
    });
    
    blobStream.end(file.buffer);
  });
};

/**
 * Delete file from Google Cloud Storage
 * @param {String} gcsUri - GCS URI of the file (gs://bucket-name/path/to/file)
 * @returns {Promise<Boolean>}
 */
const deleteFile = async (gcsUri) => {
  try {
    // Check if it's a GCS URI (starts with gs://)
    if (gcsUri.startsWith('gs://')) {
      // Remove the gs:// prefix and split into bucket and filename
      const uriWithoutPrefix = gcsUri.replace('gs://', '');
      const [bucketName, ...fileNameParts] = uriWithoutPrefix.split('/');
      const fileName = fileNameParts.join('/');
      
      const file = storage.bucket(bucketName).file(fileName);
      await file.delete();
    } else {
      // For backward compatibility with older records that might have HTTP URLs
      const fileName = gcsUri.split(`https://storage.googleapis.com/${bucket.name}/`)[1];
      if (fileName) {
        const file = bucket.file(fileName);
        await file.delete();
      } else {
        throw new Error('Invalid file URL format');
      }
    }
    return true;
  } catch (error) {
    console.error('Delete error:', error);
    throw error;
  }
};

/**
 * Generate signed URL for temporary access
 * @param {String} gcsUri - GCS URI of the file (gs://bucket-name/path/to/file)
 * @param {Number} expiresInMinutes - How long the URL should be valid
 * @returns {Promise<String>} - Signed URL
 */
const getSignedUrl = async (gcsUri, expiresInMinutes = 60) => {
  try {
    // Check if it's a GCS URI (starts with gs://)
    if (gcsUri.startsWith('gs://')) {
      // Remove the gs:// prefix and split into bucket and filename
      const uriWithoutPrefix = gcsUri.replace('gs://', '');
      const [bucketName, ...fileNameParts] = uriWithoutPrefix.split('/');
      const fileName = fileNameParts.join('/');
      
      const file = storage.bucket(bucketName).file(fileName);
      
      const options = {
        version: 'v4',
        action: 'read',
        expires: Date.now() + expiresInMinutes * 60 * 1000,
      };
      
      const [url] = await file.getSignedUrl(options);
      return url;
    } else {
      throw new Error('Invalid GCS URI format');
    }
  } catch (error) {
    console.error('Signed URL error:', error);
    throw error;
  }
};

module.exports = {
  uploadFile,
  deleteFile,
  getSignedUrl
};