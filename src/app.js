const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const path = require('path');
const http = require('http'); // Added for Socket.io

// Load environment variables
dotenv.config();

// Import routes
const authRoutes = require('./routes/authRoutes');
const reportRoutes = require('./routes/reportRoutes');
const evidenceRoutes = require('./routes/evidenceRoutes');
const serviceProviderRoutes = require('./routes/serviceProviderRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const voiceReportRoutes = require('./routes/voiceReportRoutes');
const passport = require('./config/googleAuth');
const googleAuthRoutes = require('./routes/googleAuthRoutes');

const app = express();

// Create HTTP server (for Socket.io)
const server = http.createServer(app);

// Initialize Socket.io
const socketService = require('./services/socketService');
socketService.initialize(server);

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(passport.initialize());

// Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/reports', reportRoutes);
app.use('/api/v1', evidenceRoutes);
app.use('/api/v1/providers', serviceProviderRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/voice-reports', voiceReportRoutes);
app.use('/api/v1/auth', googleAuthRoutes);

// Serve static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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

// Test route for AI services
app.post('/api/v1/test/ai', require('./middleware/auth').isAuthenticated, async (req, res) => {
  try {
    const enhancedAiService = require('./services/enhancedAiService');
    const { text, language = 'en' } = req.body;
    
    if (!text) {
      return res.status(400).json({
        success: false,
        message: 'Text is required'
      });
    }
    
    console.log(`Testing AI processing with${process.env.USE_MOCK_AI === 'true' ? ' mock' : ' real'} implementation`);
    const result = await enhancedAiService.processWithAI(text, language);
    
    return res.status(200).json({
      success: true,
      result,
      isMock: process.env.USE_MOCK_AI === 'true'
    });
  } catch (error) {
    console.error('Error testing AI processing:', error);
    return res.status(500).json({
      success: false,
      message: 'Error testing AI processing',
      error: error.message
    });
  }
});

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
  console.log(`AI Mode: ${process.env.USE_MOCK_AI === 'true' ? 'Mock Implementation' : 'Real APIs'}`);
});

module.exports = app;