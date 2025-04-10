const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } = require('@whiskeysockets/baileys');
const fs = require('fs-extra');
const EventEmitter = require('events');
const path = require('path');

class WhatsAppClient extends EventEmitter {
  constructor(sessionId) {
    super();
    this.sessionId = sessionId;
    this.sessionDir = path.join('./sessions', sessionId);
    this.socket = null;
    this.isConnected = false;
    this.phoneNumber = null;
  }
  
  async initialize() {
    try {
      // Ensure session directory exists
      await fs.ensureDir(this.sessionDir);
      
      // Get or create auth state
      const { state, saveCreds } = await useMultiFileAuthState(this.sessionDir);
      
      // Create socket
      this.socket = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        defaultQueryTimeoutMs: 60000
      });
      
      // Set up connection updates handler
      this.socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
          // Emit QR code
          this.emit('qr', qr);
        }
        
        if (connection === 'close') {
          // Connection closed
          const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
          
          if (shouldReconnect) {
            // Connection error, but not logged out
            console.log(`Connection closed for ${this.sessionId}. Reconnecting...`);
            await this.initialize();
          } else {
            // Logged out, delete session files
            console.log(`Logged out from ${this.sessionId}`);
            this.isConnected = false;
            this.phoneNumber = null;
            this.emit('disconnected');
            await fs.remove(this.sessionDir);
          }
        } else if (connection === 'connecting') {
          console.log(`Connecting to WhatsApp for ${this.sessionId}...`);
          this.emit('loading');
        } else if (connection === 'open') {
          // Connection established
          console.log(`Connected to WhatsApp for ${this.sessionId}`);
          this.isConnected = true;
          
          // Get phone number
          const phoneNumber = this.socket.user?.id?.split(':')[0] || 'unknown';
          this.phoneNumber = phoneNumber;
          
          this.emit('ready', phoneNumber);
        }
      });
      
      // Save credentials on updates
      this.socket.ev.on('creds.update', saveCreds);
      
      return true;
    } catch (error) {
      console.error(`Failed to initialize WhatsApp for ${this.sessionId}:`, error);
      this.emit('error', error);
      return false;
    }
  }
  
  async sendTextMessage(number, text) {
    try {
      if (!this.isConnected || !this.socket) {
        throw new Error('WhatsApp not connected');
      }
      
      // Format number for WhatsApp
      const formattedNumber = this.formatNumber(number);
      
      // Send message
      const result = await this.socket.sendMessage(formattedNumber, { text });
      
      return result;
    } catch (error) {
      console.error(`Failed to send message for ${this.sessionId}:`, error);
      throw error;
    }
  }
  
  async sendMediaMessage(number, filePath, caption = '', mimetype = '') {
    try {
      if (!this.isConnected || !this.socket) {
        throw new Error('WhatsApp not connected');
      }
      
      // Format number for WhatsApp
      const formattedNumber = this.formatNumber(number);
      
      // Read file
      const buffer = await fs.readFile(filePath);
      
      // Determine content type
      let messageContent = {};
      
      if (mimetype.startsWith('image/')) {
        messageContent = {
          image: buffer,
          caption: caption
        };
      } else if (mimetype.startsWith('video/')) {
        messageContent = {
          video: buffer,
          caption: caption
        };
      } else if (mimetype === 'application/pdf') {
        messageContent = {
          document: buffer,
          mimetype: 'application/pdf',
          fileName: path.basename(filePath),
          caption: caption
        };
      } else {
        // Default to document
        messageContent = {
          document: buffer,
          mimetype: mimetype || 'application/octet-stream',
          fileName: path.basename(filePath),
          caption: caption
        };
      }
      
      // Send message
      const result = await this.socket.sendMessage(formattedNumber, messageContent);
      
      return result;
    } catch (error) {
      console.error(`Failed to send media for ${this.sessionId}:`, error);
      throw error;
    }
  }
  
  async disconnect() {
    try {
      if (this.socket) {
        await this.socket.logout();
        this.socket = null;
        this.isConnected = false;
        this.phoneNumber = null;
      }
      
      return true;
    } catch (error) {
      console.error(`Failed to disconnect ${this.sessionId}:`, error);
      return false;
    }
  }
  
  async getStatus() {
    return {
      connected: this.isConnected,
      phoneNumber: this.phoneNumber
    };
  }
  
  formatNumber(number) {
    // Remove any non-digit characters
    let cleaned = number.replace(/\D/g, '');
    
    // Remove any leading zeros
    cleaned = cleaned.replace(/^0+/, '');
    
    // If the number doesn't have a country code (assumed to be less than 10 digits),
    // add the default country code (e.g., '1' for US)
    if (cleaned.length < 10) {
      throw new Error('Invalid phone number format');
    }
    
    // Return formatted number for WhatsApp API (number@s.whatsapp.net)
    return `${cleaned}@s.whatsapp.net`;
  }
}

module.exports = WhatsAppClient;
