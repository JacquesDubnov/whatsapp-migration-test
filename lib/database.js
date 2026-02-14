const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname, '..', 'store');
const DB_PATH = path.join(DB_DIR, 'whatsapp.db');

function initDatabase() {
  fs.mkdirSync(DB_DIR, { recursive: true });

  const db = new Database(DB_PATH);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      jid TEXT PRIMARY KEY,
      name TEXT,
      is_group INTEGER DEFAULT 0,
      participant_count INTEGER DEFAULT 0,
      last_message_time INTEGER,
      description TEXT,
      metadata TEXT
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      chat_jid TEXT NOT NULL,
      sender_jid TEXT,
      sender_name TEXT,
      timestamp INTEGER,
      content TEXT,
      media_type TEXT,
      media_mime TEXT,
      media_size INTEGER,
      media_path TEXT,
      is_from_me INTEGER DEFAULT 0,
      emoji_list TEXT,
      quoted_message_id TEXT,
      raw_metadata TEXT,
      FOREIGN KEY (chat_jid) REFERENCES chats(jid)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_chat_jid ON messages(chat_jid);
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);

    CREATE TABLE IF NOT EXISTS contacts (
      jid TEXT PRIMARY KEY,
      name TEXT,
      phone_number TEXT,
      push_name TEXT
    );
  `);

  const stmts = {
    upsertChat: db.prepare(`
      INSERT INTO chats (jid, name, is_group, participant_count, last_message_time, description, metadata)
      VALUES (@jid, @name, @is_group, @participant_count, @last_message_time, @description, @metadata)
      ON CONFLICT(jid) DO UPDATE SET
        name = COALESCE(@name, chats.name),
        is_group = COALESCE(@is_group, chats.is_group),
        participant_count = COALESCE(@participant_count, chats.participant_count),
        last_message_time = MAX(COALESCE(@last_message_time, 0), COALESCE(chats.last_message_time, 0)),
        description = COALESCE(@description, chats.description),
        metadata = COALESCE(@metadata, chats.metadata)
    `),

    upsertMessage: db.prepare(`
      INSERT INTO messages (id, chat_jid, sender_jid, sender_name, timestamp, content, media_type, media_mime, media_size, media_path, is_from_me, emoji_list, quoted_message_id, raw_metadata)
      VALUES (@id, @chat_jid, @sender_jid, @sender_name, @timestamp, @content, @media_type, @media_mime, @media_size, @media_path, @is_from_me, @emoji_list, @quoted_message_id, @raw_metadata)
      ON CONFLICT(id) DO UPDATE SET
        content = COALESCE(@content, messages.content),
        media_path = COALESCE(@media_path, messages.media_path),
        sender_name = COALESCE(@sender_name, messages.sender_name),
        raw_metadata = COALESCE(@raw_metadata, messages.raw_metadata)
    `),

    upsertContact: db.prepare(`
      INSERT INTO contacts (jid, name, phone_number, push_name)
      VALUES (@jid, @name, @phone_number, @push_name)
      ON CONFLICT(jid) DO UPDATE SET
        name = COALESCE(@name, contacts.name),
        phone_number = COALESCE(@phone_number, contacts.phone_number),
        push_name = COALESCE(@push_name, contacts.push_name)
    `),

    getChats: db.prepare(`
      SELECT c.*, COUNT(m.id) as message_count
      FROM chats c
      LEFT JOIN messages m ON m.chat_jid = c.jid
      GROUP BY c.jid
      ORDER BY c.last_message_time DESC
    `),

    getMessages: db.prepare(`
      SELECT * FROM messages
      WHERE chat_jid = @chat_jid
      ORDER BY timestamp ASC
      LIMIT @limit OFFSET @offset
    `),

    getMessageCount: db.prepare(`
      SELECT COUNT(*) as count FROM messages WHERE chat_jid = @chat_jid
    `),

    getChatStats: db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM chats) as total_chats,
        (SELECT COUNT(*) FROM messages) as total_messages,
        (SELECT COUNT(*) FROM messages WHERE media_type IS NOT NULL) as total_media,
        (SELECT COUNT(*) FROM contacts) as total_contacts
    `),

    updateMediaPath: db.prepare(`
      UPDATE messages SET media_path = @media_path WHERE id = @id
    `),

    getMessageById: db.prepare(`
      SELECT * FROM messages WHERE id = @id
    `),
  };

  return {
    db,

    upsertChat(chat) {
      stmts.upsertChat.run({
        jid: chat.jid,
        name: chat.name || null,
        is_group: chat.is_group ? 1 : 0,
        participant_count: chat.participant_count || 0,
        last_message_time: chat.last_message_time || null,
        description: chat.description || null,
        metadata: chat.metadata ? JSON.stringify(chat.metadata) : null,
      });
    },

    upsertMessage(msg) {
      stmts.upsertMessage.run({
        id: msg.id,
        chat_jid: msg.chat_jid,
        sender_jid: msg.sender_jid || null,
        sender_name: msg.sender_name || null,
        timestamp: msg.timestamp || null,
        content: msg.content || null,
        media_type: msg.media_type || null,
        media_mime: msg.media_mime || null,
        media_size: msg.media_size || null,
        media_path: msg.media_path || null,
        is_from_me: msg.is_from_me ? 1 : 0,
        emoji_list: msg.emoji_list ? JSON.stringify(msg.emoji_list) : null,
        quoted_message_id: msg.quoted_message_id || null,
        raw_metadata: msg.raw_metadata ? JSON.stringify(msg.raw_metadata) : null,
      });
    },

    upsertContact(contact) {
      stmts.upsertContact.run({
        jid: contact.jid,
        name: contact.name || null,
        phone_number: contact.phone_number || null,
        push_name: contact.push_name || null,
      });
    },

    getChats() {
      return stmts.getChats.all();
    },

    getMessages(chatJid, page = 1, limit = 100) {
      const offset = (page - 1) * limit;
      const messages = stmts.getMessages.all({ chat_jid: chatJid, limit, offset });
      const { count } = stmts.getMessageCount.get({ chat_jid: chatJid });
      return { messages, total: count, page, limit };
    },

    getChatStats() {
      return stmts.getChatStats.get();
    },

    updateMessageMediaPath(messageId, mediaPath) {
      stmts.updateMediaPath.run({ id: messageId, media_path: mediaPath });
    },

    getMessageById(id) {
      return stmts.getMessageById.get({ id });
    },
  };
}

module.exports = { initDatabase };
