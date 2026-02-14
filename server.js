const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');
const { initDatabase } = require('./lib/database');
const { createWhatsAppClient } = require('./lib/whatsapp');

const PORT = 5173;

const app = express();
const server = http.createServer(app);

// WebSocket server on /ws path
const wss = new WebSocketServer({ server, path: '/ws' });

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Initialize database
const db = initDatabase();

// REST API

app.get('/api/status', (req, res) => {
  const stats = db.getChatStats();
  res.json({
    status: 'running',
    ...stats,
  });
});

app.get('/api/chats', (req, res) => {
  const chats = db.getChats();
  res.json(chats);
});

app.get('/api/chats/:jid/messages', (req, res) => {
  const { jid } = req.params;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 100;
  const result = db.getMessages(jid, page, limit);
  res.json(result);
});

app.get('/api/media/:chatJid/:messageId', (req, res) => {
  const { chatJid, messageId } = req.params;
  const mediaDir = path.join(__dirname, 'media', chatJid);

  if (!fs.existsSync(mediaDir)) {
    return res.status(404).json({ error: 'Not found' });
  }

  // Find the file -- extension varies
  const files = fs.readdirSync(mediaDir).filter(f => f.startsWith(messageId));
  if (files.length === 0) {
    return res.status(404).json({ error: 'Not found' });
  }

  res.sendFile(path.join(mediaDir, files[0]));
});

// WebSocket connection handler
wss.on('connection', (ws) => {
  console.log('[server] WebSocket client connected');
  ws.send(JSON.stringify({ type: 'status', data: 'waiting' }));
});

// Start WhatsApp client
createWhatsAppClient(db, wss).then(() => {
  console.log('[server] WhatsApp client initialized');
}).catch((err) => {
  console.error('[server] WhatsApp client error:', err.message);
});

// Start server
server.listen(PORT, () => {
  console.log(`[server] Running on http://localhost:${PORT}`);
  console.log('[server] Waiting for QR code scan...');
});
