# WhatsApp Data Viewer -- Design Document

**Date:** 2026-02-14
**Project:** WhatsApp Migration Test (ThirdAct PoC)
**Purpose:** Prove WhatsApp chat history can be extracted, parsed, and displayed with full metadata exposure.

---

## Architecture

```
+-------------------+     +-------------------+     +------------------+
|  Browser (5173)   |<--->|  Express Server    |<--->|  Baileys Client  |
|  Vanilla HTML/JS  | WS  |  REST API + WS     |     |  WhatsApp Web    |
|  CSS Grid Tables  | REST|  SQLite Storage     |     |  Multi-device    |
+-------------------+     +-------------------+     +------------------+
                                   |
                           +-------v-------+
                           |  SQLite DB    |
                           |  messages     |
                           |  chats        |
                           |  contacts     |
                           |  media/       |
                           +---------------+
```

### Stack

- **Backend:** Node.js, Express, better-sqlite3, ws (WebSocket), @whiskeysockets/baileys
- **Frontend:** Vanilla HTML/CSS/JS, no build step, served by Express
- **Storage:** SQLite (data), filesystem (media files)
- **Port:** 5173

---

## Connection Flow

1. User opens localhost:5173
2. Frontend connects WebSocket to server
3. Server initializes Baileys, generates QR code
4. QR code pushed to frontend via WebSocket, rendered as scannable image
5. User scans with WhatsApp mobile
6. Connection confirmed, server begins syncing message history
7. Baileys fires messaging-history.set events as history chunks arrive
8. Server stores everything in SQLite, notifies frontend via WebSocket
9. Frontend fetches chat list and renders cards

---

## Data Storage

### SQLite Tables

**chats:**
- jid (PK), name, is_group, participant_count, last_message_time
- metadata (JSON blob -- group description, creation date, extra fields)

**messages:**
- id (PK), chat_jid (FK), sender_jid, sender_name, timestamp, content
- media_type, media_mime, media_size, media_path (local file if downloaded)
- is_from_me, has_emoji, emoji_list (JSON array of emojis in content)
- quoted_message_id, raw_metadata (JSON blob of full protobuf fields)

**contacts:**
- jid (PK), name, phone_number, push_name

### Media Storage

Files saved to media/<chat_jid>/<message_id>.<ext>
- Attempt download for all media messages via Baileys downloadMediaMessage()
- If download fails (expired URL), store media_type/media_mime but leave media_path null
- Images with valid media_path render inline in the UI

---

## API

### REST Endpoints

- GET /api/status -- connection state + sync progress
- GET /api/chats -- all chats with metadata, sorted by last active
- GET /api/chats/:jid/messages?page=0&limit=50 -- paginated messages for a chat
- GET /api/media/:chatJid/:messageId -- serve downloaded media file

### WebSocket Events (server -> client)

- qr: QR code data string
- status: connection state (disconnected/scanning/connected/syncing)
- sync-progress: { chatsLoaded, messagesLoaded, mediaDownloaded, mediaFailed }

---

## Frontend Design

### Visual Identity

- **Aesthetic:** Terminal-meets-modern. Dense information display with generous whitespace.
- **Typography:** Monospaced font (JetBrains Mono or system monospace), small size (12-13px)
- **Colors:** Dark background (#0a0a0a), subtle borders (#1a1a1a), muted text (#888), bright accents for data
- **Spacing:** Tight line-height within data rows, ample padding on card borders and section gaps
- **Layout:** Single column, full-width cards, scrollable page

### Color Palette

| Role            | Value   |
|-----------------|---------|
| Background      | #0a0a0a |
| Card background | #111111 |
| Card border     | #1e1e1e |
| Table header bg | #161616 |
| Table row hover | #1a1a1a |
| Primary text    | #e0e0e0 |
| Secondary text  | #666666 |
| Accent (green)  | #00cc88 |
| Accent (blue)   | #4a9eff |
| From-me rows    | #0d1117 |
| Group badge     | #2d5a27 |
| Media badge     | #5a4a27 |
| Error/expired   | #5a2727 |

### Layout Structure

```
+----------------------------------------------------------+
|  HEADER BAR (sticky)                                     |
|  WhatsApp Data Viewer                                    |
|  Status: [Connected]  Chats: 47  Messages: 12,340        |
+----------------------------------------------------------+
|                                                          |
|  [QR CODE AREA]  -- centered, shown until connected      |
|                                                          |
+----------------------------------------------------------+
|  CHAT CARDS (vertical scroll, full width)                |
|                                                          |
|  +------------------------------------------------------+|
|  | CHAT HEADER                                           ||
|  | Name: Family Group                                    ||
|  | JID: 123456@g.us  |  Group: Yes  |  Members: 8       ||
|  | Last Active: 2026-02-14 09:30:00                      ||
|  +------------------------------------------------------+|
|  | MESSAGE TABLE                                         ||
|  | #  | Timestamp   | Sender   | Content    | Emoji | M  ||
|  |----|-------------|----------|------------|-------|----||
|  | 01 | 09:30:12    | Dad      | Hey all    |       |    ||
|  | 02 | 09:31:44    | Mom      | Check this | 👍    | IMG||
|  |    |             |          | [image]    |       |    ||
|  | 03 | 09:32:01    | You      | Nice!      | 🎉    |    ||
|  +------------------------------------------------------+|
|  (gap)                                                   |
|  +------------------------------------------------------+|
|  | CHAT HEADER                                           ||
|  | Name: John Doe                                        ||
|  | JID: 972...@s.whatsapp.net  |  Group: No              ||
|  | ...                                                   ||
|  +------------------------------------------------------+|
+----------------------------------------------------------+
```

### Message Table Columns

| Column     | Width  | Content                                    |
|------------|--------|--------------------------------------------|
| #          | 40px   | Row number, zero-padded                    |
| Timestamp  | 120px  | HH:MM:SS format                            |
| Sender     | 140px  | Push name, truncated with tooltip for JID   |
| Content    | flex   | Message text, emojis rendered natively      |
| Emojis     | 80px   | Unique emojis from message, stacked         |
| Media      | 60px   | Type badge (IMG/VID/AUD/DOC) or empty       |
| ID         | 100px  | Message ID, truncated, copy on click        |

### Interaction

- Hover on sender: tooltip shows full JID
- Click on message ID: copies to clipboard
- Click on media badge: expands to show inline image or metadata
- Click on chat header: collapse/expand message table
- Expandable raw_metadata JSON viewer per message (click to toggle)

---

## Emoji Handling

On message store, extract all emoji characters from content using Unicode emoji regex.
Store as JSON array in emoji_list column.
Display in dedicated Emojis column showing unique emojis used in that message.

---

## File Structure

```
whatsapp-migration-test/
├── server.js                 (Express + Baileys + WebSocket + SQLite)
├── lib/
│   ├── database.js           (SQLite setup + queries)
│   ├── whatsapp.js           (Baileys client wrapper)
│   └── media.js              (Media download + emoji extraction)
├── public/
│   ├── index.html            (Single page)
│   ├── styles.css            (Dark theme, monospace, dense tables)
│   └── app.js                (WebSocket + REST + DOM rendering)
├── store/                    (SQLite DB + Baileys auth state, gitignored)
├── media/                    (Downloaded media files, gitignored)
├── package.json
├── .gitignore
└── CLAUDE.md
```

---

## Constraints

- Proof of concept only -- speed and clarity over production robustness
- Local only, single user
- No authentication on the web UI
- No send functionality -- read-only data viewer
- Port 5173
