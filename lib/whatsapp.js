const {
  makeWASocket,
  useMultiFileAuthState,
  Browsers,
  DisconnectReason,
} = require('baileys');
const pino = require('pino');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');
const { extractEmojis } = require('./emoji');
const { getMediaType, getMediaInfo, downloadMessageMedia } = require('./media');

const AUTH_DIR = path.join(__dirname, '..', 'store', 'auth');
const SYNC_SETTLE_MS = 8000; // No new history events for 8s = sync done

function broadcast(wss, data) {
  const payload = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(payload);
    }
  }
}

function extractMessageContent(msg) {
  if (!msg.message) return null;
  const m = msg.message;
  return m.conversation
    || m.extendedTextMessage?.text
    || m.imageMessage?.caption
    || m.videoMessage?.caption
    || m.documentMessage?.caption
    || m.documentWithCaptionMessage?.message?.documentMessage?.caption
    || null;
}

function extractQuotedId(msg) {
  if (!msg.message) return null;
  const m = msg.message;
  const ctx = m.extendedTextMessage?.contextInfo
    || m.imageMessage?.contextInfo
    || m.videoMessage?.contextInfo
    || m.audioMessage?.contextInfo
    || m.documentMessage?.contextInfo;
  return ctx?.stanzaId || null;
}

function extractSenderName(msg, contacts) {
  if (msg.pushName) return msg.pushName;
  const jid = msg.key.participant || msg.key.remoteJid;
  if (contacts && contacts[jid]) return contacts[jid];
  return null;
}

function processMessage(msg, contactNames) {
  const content = extractMessageContent(msg);
  const mediaInfo = getMediaInfo(msg);
  const emojis = extractEmojis(content);
  const timestamp = msg.messageTimestamp
    ? (typeof msg.messageTimestamp === 'object' ? Number(msg.messageTimestamp.low) : Number(msg.messageTimestamp))
    : null;

  return {
    id: msg.key.id,
    chat_jid: msg.key.remoteJid,
    sender_jid: msg.key.participant || msg.key.remoteJid,
    sender_name: extractSenderName(msg, contactNames),
    timestamp,
    content,
    media_type: mediaInfo?.type || null,
    media_mime: mediaInfo?.mime || null,
    media_size: mediaInfo?.size || null,
    media_path: null,
    is_from_me: msg.key.fromMe ? 1 : 0,
    emoji_list: emojis.length > 0 ? emojis : null,
    quoted_message_id: extractQuotedId(msg),
    raw_metadata: {
      messageTimestamp: timestamp,
      status: msg.status,
      broadcast: msg.broadcast,
      pushName: msg.pushName,
    },
  };
}

async function createWhatsAppClient(db, wss) {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const contactNames = {};
  const pendingMediaDownloads = [];
  let syncSettleTimer = null;
  let syncComplete = false;

  const sock = makeWASocket({
    auth: state,
    syncFullHistory: true,
    browser: Browsers.macOS('Desktop'),
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    logger: pino({ level: 'silent' }),
    getMessage: async (key) => {
      const msg = db.getMessageById(key.id);
      if (msg?.raw_metadata) {
        try { return JSON.parse(msg.raw_metadata); } catch { return undefined; }
      }
      return undefined;
    },
  });

  const syncCounts = { chats: 0, messages: 0, contacts: 0, media: 0 };

  async function finishSync() {
    if (syncComplete) return;
    syncComplete = true;

    console.log('[whatsapp] Sync settled. Waiting for media downloads...');
    broadcast(wss, {
      type: 'sync-phase',
      data: { phase: 'downloading-media', pending: pendingMediaDownloads.length },
    });

    // Wait for all pending media downloads
    const results = await Promise.allSettled(pendingMediaDownloads);
    const downloaded = results.filter(r => r.status === 'fulfilled' && r.value).length;
    console.log(`[whatsapp] Media downloads complete: ${downloaded}/${pendingMediaDownloads.length}`);

    // Broadcast final stats
    const stats = db.getChatStats();
    broadcast(wss, {
      type: 'sync-complete',
      data: {
        chats: stats.total_chats,
        messages: stats.total_messages,
        media: stats.total_media,
        contacts: stats.total_contacts,
        media_downloaded: downloaded,
      },
    });

    console.log(`[whatsapp] Sync complete: ${stats.total_chats} chats, ${stats.total_messages} messages, ${stats.total_media} media`);

    // Log out and clean up
    console.log('[whatsapp] Logging out and disconnecting...');
    try {
      await sock.logout();
    } catch {
      // Already disconnected or logout failed -- that's fine
    }

    sock.ev.removeAllListeners();

    // Remove auth state so next run starts fresh with a new QR
    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    fs.mkdirSync(AUTH_DIR, { recursive: true });

    console.log('[whatsapp] Disconnected. Data saved locally.');
    broadcast(wss, { type: 'status', data: 'disconnected' });
  }

  function resetSyncSettleTimer() {
    clearTimeout(syncSettleTimer);
    syncSettleTimer = setTimeout(finishSync, SYNC_SETTLE_MS);
  }

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      const dataUrl = await qrcode.toDataURL(qr, { width: 256, margin: 2 });
      broadcast(wss, { type: 'qr', data: dataUrl });
      console.log('[whatsapp] QR code generated, scan with WhatsApp');
    }

    if (connection === 'open') {
      broadcast(wss, { type: 'status', data: 'connected' });
      console.log('[whatsapp] Connected -- syncing history...');
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      sock.ev.removeAllListeners();

      if (syncComplete) {
        // Expected -- we triggered the logout
        console.log('[whatsapp] Clean disconnect after sync.');
      } else if (statusCode === DisconnectReason.loggedOut) {
        broadcast(wss, { type: 'status', data: 'logged_out' });
        console.log('[whatsapp] Logged out before sync completed');
      } else {
        // Unexpected disconnect during sync -- retry
        broadcast(wss, { type: 'status', data: 'reconnecting' });
        console.log('[whatsapp] Disconnected during sync, reconnecting...', statusCode);
        setTimeout(() => createWhatsAppClient(db, wss), 3000);
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messaging-history.set', ({ chats, contacts, messages }) => {
    if (syncComplete) return;

    if (contacts?.length) {
      for (const contact of contacts) {
        const jid = contact.id;
        const name = contact.name || contact.notify || contact.verifiedName || null;
        if (name) contactNames[jid] = name;

        db.upsertContact({
          jid,
          name: contact.name || null,
          phone_number: jid.split('@')[0] || null,
          push_name: contact.notify || null,
        });
        syncCounts.contacts++;
      }
    }

    if (chats?.length) {
      for (const chat of chats) {
        const isGroup = chat.id.endsWith('@g.us');
        const lastMsg = chat.messages?.[0]?.message;
        const lastTime = lastMsg?.messageTimestamp
          ? Number(lastMsg.messageTimestamp)
          : (chat.conversationTimestamp ? Number(chat.conversationTimestamp) : null);

        db.upsertChat({
          jid: chat.id,
          name: chat.name || contactNames[chat.id] || null,
          is_group: isGroup,
          participant_count: chat.participantCount || 0,
          last_message_time: lastTime,
          description: chat.description || null,
          metadata: {
            unreadCount: chat.unreadCount,
            readOnly: chat.readOnly,
            archived: chat.archive,
            pinned: chat.pinned,
          },
        });
        syncCounts.chats++;
      }
    }

    if (messages?.length) {
      for (const msg of messages) {
        const processed = processMessage(msg, contactNames);
        db.upsertMessage(processed);
        syncCounts.messages++;

        if (processed.media_type) {
          const downloadPromise = downloadMessageMedia(msg, sock).then((filePath) => {
            if (filePath) {
              db.updateMessageMediaPath(processed.id, filePath);
              syncCounts.media++;
              return filePath;
            }
            return null;
          }).catch(() => null);
          pendingMediaDownloads.push(downloadPromise);
        }
      }
    }

    broadcast(wss, {
      type: 'sync-progress',
      data: { ...syncCounts, pending_media: pendingMediaDownloads.length },
    });

    console.log(`[whatsapp] Sync: ${syncCounts.chats} chats, ${syncCounts.messages} messages, ${syncCounts.contacts} contacts`);

    // Reset the settle timer -- sync is still active
    resetSyncSettleTimer();
  });

  // Also catch real-time messages during sync
  sock.ev.on('messages.upsert', ({ messages: msgs }) => {
    if (syncComplete || !msgs?.length) return;

    for (const msg of msgs) {
      const processed = processMessage(msg, contactNames);
      db.upsertMessage(processed);

      if (processed.media_type) {
        const downloadPromise = downloadMessageMedia(msg, sock).then((filePath) => {
          if (filePath) {
            db.updateMessageMediaPath(processed.id, filePath);
            syncCounts.media++;
            return filePath;
          }
          return null;
        }).catch(() => null);
        pendingMediaDownloads.push(downloadPromise);
      }
    }
  });

  return sock;
}

module.exports = { createWhatsAppClient };
