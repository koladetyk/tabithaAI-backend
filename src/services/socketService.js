// src/services/socketService.js
const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');

let io;

// Initialize Socket.io with HTTP server
const initialize = (server) => {
  io = socketIo(server, {
    cors: {
      origin: process.env.FRONTEND_URL || '*',
      methods: ["GET", "POST"],
      credentials: true
    }
  });

  // Authentication middleware for sockets
  io.use((socket, next) => {
    if (socket.handshake.query && socket.handshake.query.token) {
      jwt.verify(socket.handshake.query.token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
          return next(new Error('Authentication error'));
        }
        socket.userId = decoded.id;
        next();
      });
    } else {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.userId}`);
    
    // Join a room specific to this user for targeted notifications
    socket.join(`user:${socket.userId}`);
    
    socket.on('disconnect', () => {
      console.log(`User disconnected: ${socket.userId}`);
    });
  });
  
  return io;
};

// Get the io instance
const getIO = () => {
  if (!io) {
    throw new Error('Socket.io not initialized');
  }
  return io;
};

// Send notification to specific user
const sendNotification = (userId, notification) => {
  if (!io) return;
  
  io.to(`user:${userId}`).emit('notification', notification);
};

module.exports = {
  initialize,
  getIO,
  sendNotification
};