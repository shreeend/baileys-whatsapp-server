const express = require('express');
const cors = require('cors');
const socketIO = require('socket.io');
const http = require('http');
const { Boom } = require('@hapi/boom');
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const fs = require('fs-extra');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// Create necessary directories
const sessionsDir = path.join(__dirname, 'sessions');
const mediaDir = path.join(__dirname, 'media');

if (!fs.existsSync(sessionsDir)) {
  fs.mkdirSync(sessionsDir);
}

if (!fs.existsSync(mediaDir)) {
  fs.mkdirSync(mediaDir);
}

// WhatsApp client setup
let sock = null;
let qr = null;

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(sessionsDir);
  
  sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    defaultQueryTimeoutMs: undefined,
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr: newQr } = update;
    
    if (newQr) {
      qr = newQr;
      io.emit('qr', qr);
      const qrCode = await qrcode.toDataURL(qr);
      io.emit('qrCode', qrCode);
    }

    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        connectToWhatsApp();
      }
    } else if (connection === 'open') {
      io.emit('connection', 'connected');
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // Message handling
  sock.ev.on('messages.upsert', async (m) => {
    if (m.type === 'notify') {
      for (const msg of m.messages) {
        io.emit('message', msg);
      }
    }
  });
}

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('Client connected');

  socket.on('sendMessage', async (data) => {
    try {
      await sock.sendMessage(data.to, { text: data.message });
      socket.emit('messageSent', { success: true });
    } catch (error) {
      socket.emit('messageSent', { success: false, error: error.message });
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

// Initialize WhatsApp connection
connectToWhatsApp();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 