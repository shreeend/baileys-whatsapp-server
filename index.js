const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs-extra');
const multer = require('multer');
const QRCode = require('qrcode');
const WhatsAppClient = require('./whatsAppClient');

// Setup Express server
const app = express();
const server = http.createServer(app);
const port = process.env.PORT || 3001;

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.ensureDirSync('./media');
    cb(null, './media');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage });

// Create Socket.IO server with CORS
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Setup middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Ensure sessions directory exists
fs.ensureDirSync('./sessions');
fs.ensureDirSync('./media');

// Store active sessions
const sessions = {};

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0' });
});

// Socket.IO connection handler
io.on('connection', (socket) => {
  let deviceId = socket.handshake.query.deviceId;
  
  console.log(`New socket connection: ${socket.id} for device: ${deviceId}`);
  
  if (!deviceId) {
    socket.emit('error', { message: 'Device ID is required' });
    return socket.disconnect();
  }
  
  socket.on('initialize', async (data) => {
    // If device ID was provided in data, use it (for backward compatibility)
    if (data && data.deviceId) {
      deviceId = data.deviceId;
    }
    
    console.log(`Initializing WhatsApp for device: ${deviceId}`);
    
    // If a session already exists for this device, disconnect it
    if (sessions[deviceId]) {
      await sessions[deviceId].disconnect();
      delete sessions[deviceId];
    }
    
    // Create a new WhatsApp client
    const client = new WhatsAppClient(deviceId);
    sessions[deviceId] = client;
    
    // Set up event handlers
    client.on('qr', async (qrData) => {
      try {
        // Generate QR code as data URL
        const qrDataUrl = await QRCode.toDataURL(qrData);
        socket.emit('qr', qrDataUrl);
      } catch (error) {
        console.error('Failed to generate QR code:', error);
        socket.emit('error', { message: 'Failed to generate QR code' });
      }
    });
    
    client.on('loading', () => {
      socket.emit('scanning');
    });
    
    client.on('ready', (phoneNumber) => {
      socket.emit('ready', { phoneNumber });
    });
    
    client.on('disconnected', () => {
      socket.emit('disconnected');
    });
    
    // Initialize the client
    await client.initialize();
  });
  
  socket.on('disconnect', async () => {
    console.log(`Socket disconnected: ${socket.id} for device: ${deviceId}`);
    
    // Don't disconnect WhatsApp client on socket disconnect
    // This allows reconnection without losing the WhatsApp session
  });
});

// API endpoint to send text message
app.post('/send-message', async (req, res) => {
  try {
    const { deviceId, number, message } = req.body;
    
    if (!deviceId || !number || !message) {
      return res.status(400).json({ 
        success: false, 
        message: 'Device ID, number, and message are required' 
      });
    }
    
    // Check if session exists
    if (!sessions[deviceId]) {
      return res.status(404).json({ 
        success: false, 
        message: 'Device not found or not connected' 
      });
    }
    
    // Send message
    const result = await sessions[deviceId].sendTextMessage(number, message);
    
    res.json({ success: true, result });
  } catch (error) {
    console.error('Failed to send message:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to send message', 
      error: error.message 
    });
  }
});

// API endpoint to send media message (image, pdf, etc.)
app.post('/send-media', upload.single('file'), async (req, res) => {
  try {
    const { deviceId, number, caption } = req.body;
    const file = req.file;
    
    if (!deviceId || !number || !file) {
      return res.status(400).json({ 
        success: false, 
        message: 'Device ID, number, and file are required' 
      });
    }
    
    // Check if session exists
    if (!sessions[deviceId]) {
      return res.status(404).json({ 
        success: false, 
        message: 'Device not found or not connected' 
      });
    }
    
    // Send media
    const result = await sessions[deviceId].sendMediaMessage(
      number, 
      file.path,
      caption || '',
      file.mimetype
    );
    
    res.json({ success: true, result });
  } catch (error) {
    console.error('Failed to send media:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to send media', 
      error: error.message 
    });
  }
});

// API endpoint to disconnect a device
app.post('/disconnect', async (req, res) => {
  try {
    const { deviceId } = req.body;
    
    if (!deviceId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Device ID is required' 
      });
    }
    
    // Check if session exists
    if (!sessions[deviceId]) {
      return res.status(404).json({ 
        success: false, 
        message: 'Device not found or not connected' 
      });
    }
    
    // Disconnect
    await sessions[deviceId].disconnect();
    delete sessions[deviceId];
    
    res.json({ success: true, message: 'Device disconnected successfully' });
  } catch (error) {
    console.error('Failed to disconnect device:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to disconnect device', 
      error: error.message 
    });
  }
});

// API endpoint to check the status of a device
app.get('/status/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;
    
    if (!deviceId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Device ID is required' 
      });
    }
    
    // Check if session exists
    if (!sessions[deviceId]) {
      return res.json({ 
        success: true, 
        connected: false
      });
    }
    
    // Get status
    const status = await sessions[deviceId].getStatus();
    
    res.json({ 
      success: true, 
      connected: status.connected,
      phoneNumber: status.phoneNumber
    });
  } catch (error) {
    console.error('Failed to get device status:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get device status', 
      error: error.message 
    });
  }
});

// Start the server
server.listen(port, () => {
  console.log(`WhatsApp API server is running on port ${port}`);
});
