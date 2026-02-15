# WhatsApp Migration Test

A proof-of-concept tool that extracts WhatsApp chat history via the WhatsApp Web protocol, parses it into structured metadata, stores everything in a local SQLite database, and serves it through a web-based data viewer. Built to validate that WhatsApp historical data (messages, contacts, media, group metadata) can be programmatically extracted, transformed, and imported into external systems.

## Purpose

This project was built as a technical feasibility test for migrating WhatsApp data into OBLIQ Messaging Platform. The goal was to prove that:

1. WhatsApp chat history can be extracted via the multi-device Web protocol (no phone root/jailbreak required)
2. Messages, media files, contact names, and group metadata can be parsed into clean, structured data
3. The extracted data can be stored locally and served as a browsable archive
4. Media files (images, videos, audio, documents) can be downloaded before the session ends

This is a **one-shot extraction tool**, not a persistent WhatsApp client. It connects, downloads everything, disconnects, and then serves the data locally from SQLite.

## How It Works

### Architecture

```
+------------------+     WebSocket      +------------------+
|                  | <================> |                  |
|   Browser UI     |     REST API       |   Express Server |
|   (public/)      | <---------------> |   (server.js)    |
|                  |                    |                  |
+------------------+                    +--------+---------+
                                                 |
                                    +------------+------------+
                                    |            |            |
                              +-----+----+ +----+-----+ +----+-----+
                              | WhatsApp | | Database | |  Media   |
                              | Client   | | (SQLite) | | Download |
                              | (Baileys)| |          | |          |
                              +----------+ +----------+ +----------+
```

### Sync-Once Lifecycle

```
1. START        Server boots, checks SQLite for existing data
                  |
                  +-- Data exists? --> Serve from local DB (no WhatsApp connection)
                  |
                  +-- No data? --> Initialize WhatsApp client
                        |
2. QR SCAN      Generate QR code via Baileys, display in browser via WebSocket
                        |
3. CONNECT      WhatsApp Web multi-device protocol handshake
                        |
4. HISTORY SYNC Baileys requests full history sync from WhatsApp servers
                  Events received:
                    - messaging-history.set  (chats, contacts, messages in batches)
                    - contacts.upsert        (address book names with LID/PN cross-refs)
                    - contacts.update        (push name changes)
                    - lid-mapping.update     (LID <-> phone number JID mappings)
                    - messages.upsert        (real-time messages during sync)
                        |
5. SETTLE       8 seconds of no new history events = sync complete
                        |
6. NAME BACKFILL  Cross-reference contact names to unnamed message senders
                  using LID-to-PN JID mapping
                        |
7. MEDIA DOWNLOAD  Download all media files with controlled concurrency (5 parallel)
                   Two-attempt strategy per file:
                     Attempt 1: Direct download from WhatsApp CDN
                     Attempt 2: Refresh URL via updateMediaMessage, then download
                   15-second timeout per attempt to prevent hangs
                        |
8. DISCONNECT   Logout from WhatsApp, clear auth state, close socket
                        |
9. SERVE        Express serves all data from local SQLite + media files from disk
```

### Data Flow

Raw WhatsApp protocol messages are processed through this pipeline:

```
WAMessage (Baileys proto)
    |
    +--> extractMessageContent()   --> text body (conversation, caption, extended text)
    +--> getMediaInfo()            --> media type, MIME type, file size
    +--> extractEmojis()           --> unique emoji list via Unicode regex
    +--> extractQuotedId()         --> reply-to message reference
    +--> extractSenderName()       --> push name or contact lookup
    +--> messageTimestamp           --> Unix timestamp (handles Long objects)
    |
    v
Structured message object --> SQLite INSERT OR UPDATE
```

### Contact Name Resolution

WhatsApp uses two JID (Jabber ID) formats that don't directly cross-reference:

- **PN (Phone Number)**: `1234567890@s.whatsapp.net` -- used on messages
- **LID (Linked ID)**: `abcdef123456@lid` -- used in contact sync (newer format)

The system resolves names through multiple event sources and a post-sync backfill:

```
Event Sources:
  messaging-history.set  --> contact.name, contact.notify, contact.verifiedName
  contacts.upsert        --> contactAction.fullName, contactAction.lidJid, contactAction.pnJid
  contacts.update        --> partial updates (push name changes)
  lid-mapping.update     --> {lid, pn} pairs for cross-referencing
  messages               --> msg.pushName (sender's self-set display name)

Storage (contacts table):
  jid           -- primary identifier (LID or PN)
  name          -- address book name (what you saved them as)
  push_name     -- display name (what they set for themselves)
  verified_name -- business verified name
  phone_number  -- PN JID (@s.whatsapp.net)
  lid           -- LID JID (@lid)

Post-Sync Backfill:
  For each unnamed sender_jid in messages:
    1. Direct match: contacts.jid = sender_jid
    2. Phone match:  contacts.phone_number = sender_jid
    3. LID match:    contacts.lid = sender_jid
  If found, UPDATE messages SET sender_name = best_name
```

## Tech Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| WhatsApp Protocol | [Baileys v7.0.0-rc.9](https://github.com/WhiskeySockets/Baileys) | WhatsApp Web multi-device API client |
| Database | [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) | Synchronous SQLite3 bindings for Node.js |
| HTTP Server | [Express 4](https://expressjs.com/) | REST API and static file serving |
| WebSocket | [ws](https://github.com/websockets/ws) | Real-time sync progress updates to browser |
| QR Code | [qrcode](https://github.com/soldair/node-qrcode) | QR code generation for WhatsApp pairing |
| Logger | [pino](https://github.com/pinojs/pino) | Logging (used in silent mode for Baileys) |
| Frontend | Vanilla JS + CSS | No framework -- single-page data viewer |

### Why Baileys v7 (not v6)?

Baileys v6 (`@whiskeysockets/baileys` 6.7.21) had a critical bug where QR code scanning triggered a 405 HTTP error and infinite disconnect/reconnect loop. The package was also renamed from `@whiskeysockets/baileys` to `baileys` in v7. The RC9 release is the current stable candidate with working multi-device QR auth.

### Why SQLite?

- Zero configuration (no database server)
- Single-file database (`store/whatsapp.db`)
- WAL mode for concurrent read/write during sync
- Foreign keys for referential integrity
- All data portable -- copy the `store/` and `media/` directories

## Project Structure

```
whatsapp-migration-test/
|
+-- server.js                 Entry point. Express server, WebSocket, REST API
|
+-- lib/
|   +-- whatsapp.js           WhatsApp client lifecycle, sync, event handlers
|   +-- database.js           SQLite schema, prepared statements, CRUD operations
|   +-- media.js              Media download with timeout, retry, MIME detection
|   +-- emoji.js              Unicode emoji extraction via regex
|
+-- public/
|   +-- index.html            Single-page HTML shell
|   +-- app.js                Frontend: WebSocket handler, data loading, DOM rendering
|   +-- styles.css            Dark monospace theme, responsive tables
|
+-- store/                    (gitignored) Runtime data
|   +-- whatsapp.db           SQLite database
|   +-- auth/                 Baileys auth state (cleared after sync)
|
+-- media/                    (gitignored) Downloaded media files
|   +-- <chat_jid>/           One subdirectory per chat
|       +-- <msg_id>.<ext>    Media files named by message ID
|
+-- package.json
+-- .gitignore
+-- README.md
```

### File Breakdown

#### `server.js` (107 lines)

Express HTTP server with WebSocket upgrade. On startup, checks if SQLite has existing data:
- **Data exists**: Serves from local DB, no WhatsApp connection
- **No data**: Initializes WhatsApp client, begins sync

REST API endpoints:
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/status` | GET | Database stats (chat/message/media/contact counts) |
| `/api/chats` | GET | All chats with message counts, sorted by last activity |
| `/api/chats/:jid/messages` | GET | Paginated messages for a chat |
| `/api/chats/:jid/messages/all` | GET | All messages for a chat (no pagination) |
| `/api/contacts` | GET | All contacts with name fields |
| `/api/name-map` | GET | JID-to-display-name map (all JID formats) |
| `/api/media/:messageId` | GET | Serve media file by message ID |

#### `lib/whatsapp.js` (405 lines)

Core sync logic. Creates a Baileys socket with `syncFullHistory: true`, listens to six event types:

- `connection.update` -- QR code generation, connect/disconnect handling, auto-reconnect
- `creds.update` -- Auth credential persistence
- `messaging-history.set` -- Batch processing of chats, contacts, and messages
- `contacts.upsert` -- Address book sync with full name, LID, and PN identifiers
- `contacts.update` -- Push name and verified name updates
- `lid-mapping.update` -- LID-to-PN JID cross-reference storage

After sync settles (8s idle), runs:
1. **Name backfill** -- resolves unnamed message senders from contact data
2. **Media download** -- 5-concurrent batch download with progress broadcasting
3. **Cleanup** -- logout, clear auth, emit completion

#### `lib/database.js` (315 lines)

SQLite schema with three tables:

**chats** -- Chat metadata
```sql
jid TEXT PRIMARY KEY,  name TEXT,  is_group INTEGER,
participant_count INTEGER,  last_message_time INTEGER,
description TEXT,  metadata TEXT (JSON)
```

**messages** -- Individual messages with media references
```sql
id TEXT PRIMARY KEY,  chat_jid TEXT (FK -> chats),
sender_jid TEXT,  sender_name TEXT,  timestamp INTEGER,
content TEXT,  media_type TEXT,  media_mime TEXT,
media_size INTEGER,  media_path TEXT,  is_from_me INTEGER,
emoji_list TEXT (JSON),  quoted_message_id TEXT,
raw_metadata TEXT (JSON)
```

**contacts** -- Contact identity with cross-reference fields
```sql
jid TEXT PRIMARY KEY,  name TEXT,  phone_number TEXT,
push_name TEXT,  verified_name TEXT,  lid TEXT
```

All write operations use `INSERT ... ON CONFLICT DO UPDATE` (upsert) to handle duplicate data from multiple sync batches. The `backfillSenderNames()` method cross-references contacts to messages using all three JID lookup paths (direct, phone_number, lid).

#### `lib/media.js` (139 lines)

Media download with two-attempt strategy and 15-second timeout per attempt:

1. **Direct download**: `downloadMediaMessage()` from Baileys -- works when CDN URL is fresh
2. **Refresh + download**: `sock.updateMediaMessage()` to get a new URL, then download

The timeout wrapper (`withTimeout`) prevents indefinite hangs from `updateMediaMessage` and Baileys' internal `reuploadRequest`, which were observed to block forever on expired media.

Media files are organized as `media/<chat_jid>/<message_id>.<extension>` with MIME-to-extension mapping for common WhatsApp media types (JPEG, PNG, WebP, MP4, OGG/Opus, PDF, DOCX, XLSX).

#### `lib/emoji.js` (16 lines)

Unicode-aware emoji extraction using the `\p{Emoji_Presentation}` regex property. Handles emoji modifiers (skin tones), ZWJ sequences (combined emoji like family groups), and regional indicators (flags). Returns deduplicated array.

#### `public/app.js` (494 lines)

Single-page frontend with two modes:

- **Sync mode**: WebSocket connection receives QR code, sync progress, media download status
- **Viewer mode**: Fetches all data from REST API, renders collapsible chat cards with message tables

Features:
- Inline media rendering (images, video players, audio players, document download links)
- Sender display: `Name (phone number)` with JID tooltip on hover
- Click-to-expand raw metadata per message
- Click-to-copy message ID
- Media type badges (IMG, VID, AUD, DOC, STK)
- Progress bar for sync and load phases

#### `public/styles.css` (508 lines)

Dark monospace theme using JetBrains Mono. CSS custom properties for all colors. Responsive breakpoints at 1000px and 768px. Sticky table headers within scrollable chat card bodies. Custom scrollbar styling.

## Installation

### Prerequisites

- **Node.js** 18 or later (tested on 22.x)
- **npm** (comes with Node.js)
- A **WhatsApp account** with chat history
- A **phone with WhatsApp** (for QR code scanning)

### Setup

```bash
# Clone the repository
git clone https://github.com/your-username/whatsapp-migration-test.git
cd whatsapp-migration-test

# Install dependencies
npm install

# Start the server
npm start
```

The server starts on `http://localhost:5174` (override with `PORT` env var).

### First Run (Data Extraction)

1. Open `http://localhost:5174` in your browser
2. A QR code appears -- scan it with WhatsApp (Settings > Linked Devices > Link a Device)
3. The sync begins automatically:
   - Chat and contact metadata arrive first
   - Message history follows in batches (may take a few minutes for large accounts)
   - Media files download after message sync completes
4. Progress is shown in the browser (status bar, progress bar, counters)
5. When complete, the app **automatically logs out** of WhatsApp and clears auth state
6. The browser switches to viewer mode, showing all extracted data

### Subsequent Runs

If data already exists in `store/whatsapp.db`, the server skips WhatsApp connection entirely and serves from the local database. To force a fresh sync:

```bash
# Delete existing data
rm -rf store/ media/

# Restart
npm start
```

### Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `PORT` | `5174` | HTTP server port |

## Data Output

After extraction, all data is in two locations:

- **`store/whatsapp.db`** -- SQLite database with all structured data (chats, messages, contacts)
- **`media/`** -- Downloaded media files organized by chat JID

The SQLite database can be queried directly:

```bash
# Count messages per chat
sqlite3 store/whatsapp.db "SELECT c.name, COUNT(m.id) FROM chats c JOIN messages m ON m.chat_jid = c.jid GROUP BY c.jid ORDER BY COUNT(m.id) DESC;"

# List all contacts with names
sqlite3 store/whatsapp.db "SELECT jid, COALESCE(name, push_name, verified_name) as display_name FROM contacts WHERE display_name IS NOT NULL;"

# Export messages as JSON
sqlite3 -json store/whatsapp.db "SELECT * FROM messages WHERE chat_jid = '1234567890@s.whatsapp.net' ORDER BY timestamp;"
```

## Known Limitations

- **Contact names**: WhatsApp's history sync does not include phone address book names. Names come from push names (self-set by the contact) and the `contacts.upsert` event. Some contacts will only show phone numbers.
- **Media expiration**: Very old media (months+) may have expired CDN URLs. The tool attempts URL refresh via `updateMediaMessage`, but some files will fail. Typical success rate is 95%+.
- **One-shot only**: The tool is designed for a single extraction. It logs out after sync and clears auth state. Running again requires a new QR scan.
- **No E2E encryption key export**: Message content is decrypted by Baileys during sync. The raw encrypted payloads are not stored.
- **Group participant list**: Only participant count is synced, not individual member lists (would require additional API calls per group).

## Development

```bash
# Run with auto-restart on file changes
npm run dev

# The server uses Node.js --watch mode (Node 18+)
```

## License

MIT
