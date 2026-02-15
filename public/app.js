(function () {
  'use strict';

  // DOM refs
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const statChats = document.getElementById('stat-chats');
  const statMessages = document.getElementById('stat-messages');
  const qrContainer = document.getElementById('qr-container');
  const qrImage = document.getElementById('qr-image');
  const progressBarContainer = document.getElementById('progress-bar-container');
  const progressBar = document.getElementById('progress-bar');
  const chatCardsContainer = document.getElementById('chat-cards-container');

  // State
  let contactMap = {}; // jid -> display name

  // -------------------------------------------------------
  // A. WebSocket (only used during sync phase)
  // -------------------------------------------------------
  function connectWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${location.host}/ws`);

    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);

      switch (msg.type) {
        case 'qr':
          qrImage.src = msg.data;
          qrImage.classList.add('visible');
          setStatus('waiting', 'Scan QR Code');
          qrContainer.classList.remove('hidden');
          break;

        case 'status':
          handleStatusChange(msg.data);
          break;

        case 'sync-progress':
          handleSyncProgress(msg.data);
          break;

        case 'sync-phase':
          handleSyncPhase(msg.data);
          break;

        case 'sync-complete':
          handleSyncComplete(msg.data);
          break;
      }
    });

    ws.addEventListener('close', () => {
      // Connection closing is expected after sync completes.
      // Don't reconnect -- we serve from local DB now.
    });

    ws.addEventListener('error', () => {
      // Will trigger close event
    });
  }

  function handleStatusChange(status) {
    switch (status) {
      case 'has-data':
        // Server already has local data -- skip QR, load directly
        qrContainer.classList.add('hidden');
        loadFromLocalDB();
        break;

      case 'connected':
        setStatus('syncing', 'Connected, syncing history...');
        qrContainer.classList.add('hidden');
        progressBarContainer.classList.add('active');
        progressBar.style.width = '5%';
        break;

      case 'reconnecting':
        setStatus('syncing', 'Reconnecting...');
        break;

      case 'logged_out':
        setStatus('disconnected', 'Logged Out');
        qrContainer.classList.remove('hidden');
        break;

      case 'waiting':
        setStatus('waiting', 'Waiting for QR scan');
        break;

      case 'disconnected':
        // Expected after sync -- do nothing, data is loaded
        break;
    }
  }

  function handleSyncProgress(data) {
    setStatus('syncing', `Syncing: ${data.chats} chats, ${data.messages} msgs`);
    statChats.textContent = `${data.chats} chats`;
    statMessages.textContent = `${data.messages} msgs`;

    const progress = Math.min(70, 5 + (data.messages / 60));
    progressBar.style.width = `${progress}%`;
  }

  function handleSyncPhase(data) {
    if (data.phase === 'downloading-media') {
      const total = data.total || 0;
      const done = data.downloaded || 0;
      const failed = data.failed || 0;
      const remaining = total - done - failed;
      const pct = total > 0 ? Math.round((done + failed) / total * 100) : 0;
      setStatus('syncing', `Downloading media: ${done}/${total} (${failed} failed, ${remaining} left)`);
      progressBar.style.width = `${70 + (pct * 0.2)}%`;
    }
  }

  function handleSyncComplete(data) {
    setStatus('syncing', 'Sync complete. Loading data...');
    statChats.textContent = `${data.chats} chats`;
    statMessages.textContent = `${data.messages} msgs`;
    progressBar.style.width = '85%';

    // Now load everything from local DB
    loadFromLocalDB();
  }

  function setStatus(state, text) {
    statusDot.className = 'status-dot ' + state;
    statusText.textContent = text;
  }

  // -------------------------------------------------------
  // B. Data Loading (always from local DB)
  // -------------------------------------------------------
  async function loadFromLocalDB() {
    setStatus('syncing', 'Loading from local database...');
    progressBarContainer.classList.add('active');
    progressBar.style.width = '90%';

    try {
      // Fetch name map, chats in parallel
      const [chats, nameEntries] = await Promise.all([
        fetch('/api/chats').then(r => r.json()),
        fetch('/api/name-map').then(r => r.json()),
      ]);

      // Build contact lookup: jid -> best display name
      contactMap = {};
      for (const entry of nameEntries) {
        contactMap[entry.jid] = entry.name;
      }

      chatCardsContainer.innerHTML = '';
      progressBar.style.width = '93%';

      // Fetch all messages for all chats in parallel
      const messagesByChat = {};
      const fetches = chats.map(chat =>
        fetch(`/api/chats/${encodeURIComponent(chat.jid)}/messages/all`)
          .then(r => r.json())
          .then(msgs => { messagesByChat[chat.jid] = msgs; })
      );
      await Promise.all(fetches);

      progressBar.style.width = '97%';

      // Render everything
      let totalMessages = 0;
      for (const chat of chats) {
        const messages = messagesByChat[chat.jid] || [];
        totalMessages += messages.length;
        const card = renderChatCard(chat, messages);
        chatCardsContainer.appendChild(card);
      }

      // Final stats
      statChats.textContent = `${chats.length} chats`;
      statMessages.textContent = `${totalMessages} msgs`;

      progressBar.style.width = '100%';
      setStatus('connected', `Local DB: ${chats.length} chats, ${totalMessages} msgs`);

      setTimeout(() => {
        progressBarContainer.classList.remove('active');
        progressBar.style.width = '0%';
      }, 2000);
    } catch (err) {
      console.error('[app] Failed to load data:', err);
      setStatus('disconnected', 'Load failed -- refresh to retry');
    }
  }

  // -------------------------------------------------------
  // C. Rendering
  // -------------------------------------------------------
  function formatTimestamp(ts) {
    if (!ts) return '--:--:--';
    const d = new Date(ts * 1000);
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    return `${y}-${mo}-${day} ${h}:${m}:${s}`;
  }

  function formatLastActive(ts) {
    if (!ts) return 'never';
    const d = new Date(ts * 1000);
    const now = new Date();
    const diff = now - d;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return `${days}d ago`;
    return d.toLocaleDateString();
  }

  function renderChatCard(chat, messages) {
    const card = document.createElement('div');
    card.className = 'chat-card';
    card.dataset.jid = chat.jid;

    // Header
    const header = document.createElement('div');
    header.className = 'chat-card-header';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'chat-name';
    const chatDisplayName = chat.name || contactMap[chat.jid] || null;
    nameSpan.textContent = (chatDisplayName && chatDisplayName !== '.') ? chatDisplayName : chat.jid.split('@')[0];
    header.appendChild(nameSpan);

    const jidSpan = document.createElement('span');
    jidSpan.className = 'chat-jid';
    jidSpan.textContent = chat.jid;
    header.appendChild(jidSpan);

    if (chat.is_group) {
      const badge = document.createElement('span');
      badge.className = 'group-badge';
      badge.textContent = 'GROUP';
      header.appendChild(badge);
    }

    const meta = document.createElement('div');
    meta.className = 'chat-meta';

    if (chat.is_group && chat.participant_count > 0) {
      const members = document.createElement('span');
      members.textContent = `${chat.participant_count} members`;
      meta.appendChild(members);
    }

    const msgCount = document.createElement('span');
    msgCount.textContent = `${messages.length} msgs`;
    meta.appendChild(msgCount);

    const lastActive = document.createElement('span');
    lastActive.textContent = formatLastActive(chat.last_message_time);
    meta.appendChild(lastActive);

    header.appendChild(meta);

    const arrow = document.createElement('span');
    arrow.className = 'collapse-arrow';
    arrow.textContent = '\u25BC';
    header.appendChild(arrow);

    card.appendChild(header);

    // Body -- messages pre-rendered
    const body = document.createElement('div');
    body.className = 'chat-card-body';

    if (messages.length > 0) {
      const table = document.createElement('table');
      table.className = 'message-table';

      const thead = document.createElement('thead');
      thead.innerHTML = `<tr>
        <th class="col-index">#</th>
        <th class="col-timestamp">Timestamp</th>
        <th class="col-sender">Sender</th>
        <th class="col-content">Content</th>
        <th class="col-emojis">Emojis</th>
        <th class="col-media">Media</th>
        <th class="col-id">ID</th>
      </tr>`;
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      for (let i = 0; i < messages.length; i++) {
        tbody.appendChild(renderMessageRow(messages[i], i));
      }
      table.appendChild(tbody);
      body.appendChild(table);
    } else {
      const empty = document.createElement('div');
      empty.className = 'empty-chat';
      empty.textContent = 'No messages synced';
      body.appendChild(empty);
    }

    card.appendChild(body);

    // Collapse toggle
    header.addEventListener('click', () => {
      card.classList.toggle('collapsed');
    });

    // Start collapsed
    card.classList.add('collapsed');

    return card;
  }

  function renderMessageRow(msg, index) {
    const tr = document.createElement('tr');
    if (msg.is_from_me) tr.classList.add('from-me');

    // Index
    const tdIndex = document.createElement('td');
    tdIndex.className = 'col-index';
    tdIndex.textContent = String(index + 1).padStart(4, '0');
    tr.appendChild(tdIndex);

    // Timestamp
    const tdTime = document.createElement('td');
    tdTime.className = 'col-timestamp';
    tdTime.textContent = formatTimestamp(msg.timestamp);
    tr.appendChild(tdTime);

    // Sender -- show name + phone number
    const tdSender = document.createElement('td');
    tdSender.className = 'col-sender sender-cell';
    if (msg.is_from_me) {
      tdSender.textContent = 'You';
    } else {
      const phoneNumber = msg.sender_jid ? msg.sender_jid.split('@')[0] : '';
      const name = msg.sender_name
        || contactMap[msg.sender_jid]
        || contactMap[msg.chat_jid]
        || null;

      if (name && name !== phoneNumber && name !== '.') {
        tdSender.textContent = `${name} (${phoneNumber})`;
      } else {
        tdSender.textContent = phoneNumber || 'Unknown';
      }
    }
    if (msg.sender_jid) {
      const tooltip = document.createElement('span');
      tooltip.className = 'tooltip';
      tooltip.textContent = msg.sender_jid;
      tdSender.appendChild(tooltip);
    }
    tr.appendChild(tdSender);

    // Content + inline media
    const tdContent = document.createElement('td');
    tdContent.className = 'col-content';
    tdContent.textContent = msg.content || '';

    if (msg.media_path) {
      const mediaUrl = `/api/media/${encodeURIComponent(msg.id)}`;

      if (msg.media_type === 'image') {
        const img = document.createElement('img');
        img.className = 'inline-media';
        img.src = mediaUrl;
        img.alt = 'image';
        img.loading = 'lazy';
        img.addEventListener('click', (e) => {
          e.stopPropagation();
          window.open(mediaUrl, '_blank');
        });
        tdContent.appendChild(img);
      } else if (msg.media_type === 'video') {
        const video = document.createElement('video');
        video.className = 'inline-video';
        video.src = mediaUrl;
        video.controls = true;
        video.preload = 'metadata';
        tdContent.appendChild(video);
      } else if (msg.media_type === 'audio') {
        const audio = document.createElement('audio');
        audio.className = 'inline-audio';
        audio.src = mediaUrl;
        audio.controls = true;
        audio.preload = 'metadata';
        tdContent.appendChild(audio);
      } else {
        // document, sticker, or other -- show download link
        const ext = msg.media_mime ? msg.media_mime.split('/').pop().split(';')[0] : 'file';
        const link = document.createElement('a');
        link.className = 'media-link';
        link.href = mediaUrl;
        link.target = '_blank';
        link.textContent = `${msg.media_type} (.${ext})`;
        tdContent.appendChild(link);
      }
    } else if (msg.media_type) {
      // Media exists in message but wasn't downloaded (URL expired)
      const note = document.createElement('span');
      note.style.cssText = 'display:block;margin-top:4px;font-size:10px;color:var(--text-secondary)';
      note.textContent = `[${msg.media_type} -- not downloaded]`;
      tdContent.appendChild(note);
    }
    tr.appendChild(tdContent);

    // Emojis
    const tdEmojis = document.createElement('td');
    tdEmojis.className = 'col-emojis';
    if (msg.emoji_list) {
      try {
        const emojis = JSON.parse(msg.emoji_list);
        tdEmojis.textContent = emojis.join('');
      } catch { /* ignore */ }
    }
    tr.appendChild(tdEmojis);

    // Media
    const tdMedia = document.createElement('td');
    tdMedia.className = 'col-media';
    if (msg.media_type) {
      const badge = document.createElement('span');
      badge.className = `media-badge ${msg.media_type}`;
      badge.textContent = msg.media_type.substring(0, 3).toUpperCase();
      tdMedia.appendChild(badge);
    }
    tr.appendChild(tdMedia);

    // ID
    const tdId = document.createElement('td');
    tdId.className = 'col-id';
    const idSpan = document.createElement('span');
    idSpan.className = 'msg-id';
    idSpan.textContent = msg.id ? msg.id.substring(0, 10) + '...' : '';
    idSpan.title = 'Click to copy full ID';
    idSpan.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(msg.id).catch(() => {});
    });
    tdId.appendChild(idSpan);
    tr.appendChild(tdId);

    // Click to expand raw metadata
    tr.addEventListener('click', () => {
      const existing = tr.nextElementSibling;
      if (existing && existing.classList.contains('metadata-row')) {
        existing.remove();
        return;
      }

      const metaRow = document.createElement('tr');
      metaRow.className = 'metadata-row';
      const metaTd = document.createElement('td');
      metaTd.colSpan = 7;
      const metaDiv = document.createElement('div');
      metaDiv.className = 'metadata-content';

      let raw = {};
      try { raw = JSON.parse(msg.raw_metadata || '{}'); } catch { /* ignore */ }
      metaDiv.textContent = JSON.stringify({
        id: msg.id,
        chat_jid: msg.chat_jid,
        sender_jid: msg.sender_jid,
        quoted_message_id: msg.quoted_message_id,
        media_type: msg.media_type,
        media_mime: msg.media_mime,
        media_size: msg.media_size,
        media_path: msg.media_path,
        ...raw,
      }, null, 2);

      metaTd.appendChild(metaDiv);
      metaRow.appendChild(metaTd);
      tr.insertAdjacentElement('afterend', metaRow);
    });

    return tr;
  }

  // -------------------------------------------------------
  // D. Initialization
  // -------------------------------------------------------

  // Boot: connect WebSocket which tells us whether to sync or load
  connectWebSocket();
})();
