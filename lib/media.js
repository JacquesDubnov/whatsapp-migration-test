const { downloadMediaMessage } = require('baileys');
const path = require('path');
const fs = require('fs');

const MEDIA_DIR = path.join(__dirname, '..', 'media');

const MIME_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'audio/ogg; codecs=opus': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

function getMediaType(message) {
  if (!message?.message) return null;
  const msg = message.message;
  if (msg.imageMessage) return 'image';
  if (msg.videoMessage) return 'video';
  if (msg.audioMessage) return 'audio';
  if (msg.documentMessage) return 'document';
  if (msg.stickerMessage) return 'sticker';
  if (msg.documentWithCaptionMessage?.message?.documentMessage) return 'document';
  return null;
}

function getMediaInfo(message) {
  if (!message?.message) return null;
  const msg = message.message;

  const mediaMsg = msg.imageMessage
    || msg.videoMessage
    || msg.audioMessage
    || msg.documentMessage
    || msg.stickerMessage
    || msg.documentWithCaptionMessage?.message?.documentMessage;

  if (!mediaMsg) return null;

  return {
    type: getMediaType(message),
    mime: mediaMsg.mimetype || null,
    size: mediaMsg.fileLength ? Number(mediaMsg.fileLength) : null,
  };
}

function extensionFromMime(mime) {
  if (!mime) return 'bin';
  if (MIME_EXTENSIONS[mime]) return MIME_EXTENSIONS[mime];
  const sub = mime.split('/')[1];
  if (sub) return sub.split(';')[0].trim();
  return 'bin';
}

async function downloadMessageMedia(message, sock) {
  const type = getMediaType(message);
  if (!type) return null;

  const info = getMediaInfo(message);
  const ext = extensionFromMime(info?.mime);
  const chatJid = message.key.remoteJid.replace(/[/:]/g, '_');
  const messageId = message.key.id;

  const dir = path.join(MEDIA_DIR, chatJid);
  fs.mkdirSync(dir, { recursive: true });

  const filePath = path.join(dir, `${messageId}.${ext}`);

  if (fs.existsSync(filePath)) {
    return filePath;
  }

  try {
    const buffer = await downloadMediaMessage(
      message,
      'buffer',
      {},
      {
        logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, trace: () => {}, child() { return this; } },
        reuploadRequest: sock?.updateMediaMessage,
      }
    );

    fs.writeFileSync(filePath, buffer);
    return filePath;
  } catch (err) {
    // Media URL expired or network error -- expected for old messages
    return null;
  }
}

module.exports = { downloadMessageMedia, getMediaType, getMediaInfo };
