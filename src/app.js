const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const path = require('path');
const cookieParser = require('cookie-parser');
const http = require('http'); // Added for Socket.io

// Load environment variables
dotenv.config();

// Import routes
const authRoutes = require('./routes/authRoutes');
const reportRoutes = require('./routes/reportRoutes');
const evidenceRoutes = require('./routes/evidenceRoutes');
// REMOVED: serviceProviderRoutes (table deleted)
const notificationRoutes = require('./routes/notificationRoutes');
// REMOVED: voiceReportRoutes (likely AI-related functionality)
const passport = require('./config/googleAuth');
//const googleAuthRoutes = require('./routes/googleAuthRoutes');
const referralRoutes = require('./routes/referralRoutes');
// REMOVED: resourceRoutes (table deleted)
const agencyRoutes = require('./routes/agencyRoutes');
const adminRoutes = require('./routes/adminRoutes');

// Add near the top of your file, after imports
console.log('Starting application...');
console.log('Node environment:', process.env.NODE_ENV);
console.log('Current directory:', __dirname);
console.log('File location:', __filename);

const app = express();

// Create HTTP server (for Socket.io)
const server = http.createServer(app);

// Middleware
app.use(cookieParser());
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(passport.initialize());

// IMPORTANT: CORS configuration must come BEFORE route definitions
app.use(cors({
  origin: function(origin, callback) {
    const allowedOrigins = [
      process.env.FRONTEND_URL, 
      'http://localhost:3000', 
      'https://928a71dbf7cb.ngrok-free.app',
      'https://tabithaaiadmintestarea.netlify.app',
      'https://testfrontfortabithaai.netlify.app', 
      'http://localhost:8080',
      'http://127.0.0.1:3000',
      'http://localhost:5173',
      'http://127.0.0.1:5173'
    ].filter(Boolean);
    
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('CORS blocked origin:', origin);
      callback(null, false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Add a preflight handler for OPTIONS requests
app.options('*', cors());

// Debug middleware to log request details
app.use((req, res, next) => {
  console.log(`Request from origin: ${req.headers.origin}`);
  console.log(`Request method: ${req.method}`);
  console.log(`Request path: ${req.path}`);
  console.log(`Cookie header: ${req.headers.cookie}`);
  next();
});

// Initialize Socket.io
const socketService = require('./services/socketService');
socketService.initialize(server);

// Serve static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes - AFTER CORS configuration
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/reports', reportRoutes);
app.use('/api/v1', evidenceRoutes);
// REMOVED: serviceProviderRoutes (table deleted)
app.use('/api/v1/notifications', notificationRoutes);
// REMOVED: voiceReportRoutes (likely AI-related functionality)
//app.use('/api/v1/auth', googleAuthRoutes);
app.use('/api/v1', referralRoutes);
// REMOVED: resourceRoutes (table deleted)
app.use('/api/v1/agencies', agencyRoutes);
app.use('/api/v1/admin', adminRoutes);


// Root route
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to Tabitha AI API',
    version: '1.0.0'
  });
});

// Debug route for testing authentication
app.get('/api/v1/test/auth', require('./middleware/auth').isAuthenticated, (req, res) => {
  res.json({
    success: true,
    message: 'Authentication works!',
    user: {
      id: req.user.id,
      username: req.user.username
    }
  });
});

// Test route for API
app.get('/api/v1/test', (req, res) => {
  console.log('Test route hit!');
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  return res.json({ success: true, message: 'Test route works!' });
});

// REMOVED: AI test route since AI functionality was removed

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
  });
});

// Start server using the HTTP server instead of the Express app
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Add at the very bottom of your app.js, just before module.exports
server.on('error', (error) => {
  console.error('Server failed to start:', error);
  // Don't exit the process, as Railway might interpret this as a fatal error
  // Just log the error in detail
  console.error(error.stack);
});

module.exports = app;