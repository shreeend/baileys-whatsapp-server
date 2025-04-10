# Baileys WhatsApp Server

A WhatsApp automation server built with Node.js, Express, and Baileys library.

## Features

- WhatsApp Web API integration
- Real-time messaging
- QR code authentication
- Session management
- Media handling

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file with your configuration
4. Start the server:
   ```bash
   node server.js
   ```

## Environment Variables

- `PORT`: Server port (default: 3000)
- `NODE_ENV`: Environment (development/production)

## Directory Structure

- `sessions/`: WhatsApp session data
- `media/`: Media files
- `public/`: Static files
- `server.js`: Main server file
- `whatsAppClient.js`: WhatsApp client implementation 