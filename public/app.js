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
  const chatPages = {}; // jid -> current page
  let isConnected = false;

  // -------------------------------------------------------
  // A. WebSocket
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

        case 'new-messages':
          // Refresh stats on new messages
          fetchStatus();
          break;
      }
    });

    ws.addEventListener('close', () => {
      setStatus('disconnected', 'Disconnected');
      setTimeout(connectWebSocket, 3000);
    });

    ws.addEventListener('error', () => {
      // Will trigger close event
    });
  }

  function handleStatusChange(status) {
    switch (status) {
      case 'connected':
        isConnected = true;
        setStatus('connected', 'Connected');
        qrContainer.classList.add('hidden');
        progressBarContainer.classList.add('active');
        progressBar.style.width = '5%';
        // Start loading data
        loadChats();
        break;

      case 'reconnecting':
        setStatus('syncing', 'Reconnecting...');
        break;

      case 'logged_out':
        isConnected = false;
        setStatus('disconnected', 'Logged Out');
        qrContainer.classList.remove('hidden');
        break;

      case 'waiting':
        setStatus('waiting', 'Waiting');
        break;
    }
  }

  function handleSyncProgress(data) {
    setStatus('syncing', 'Syncing...');
    statChats.textContent = `${data.chats} chats`;
    statMessages.textContent = `${data.messages} msgs`;

    // Approximate progress (history sync sends multiple batches)
    const progress = Math.min(95, 5 + (data.messages / 100));
    progressBar.style.width = `${progress}%`;
  }

  function setStatus(state, text) {
    statusDot.className = 'status-dot ' + state;
    statusText.textContent = text;
  }

  // -------------------------------------------------------
  // B. Data Fetching
  // -------------------------------------------------------
  async function fetchChats() {
    const res = await fetch('/api/chats');
    return res.json();
  }

  async function fetchMessages(jid, page, limit) {
    const params = new URLSearchParams({ page, limit });
    const res = await fetch(`/api/chats/${encodeURIComponent(jid)}/messages?${params}`);
    return res.json();
  }

  async function fetchStatus() {
    const res = await fetch('/api/status');
    const data = await res.json();
    statChats.textContent = `${data.total_chats} chats`;
    statMessages.textContent = `${data.total_messages} msgs`;
    return data;
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

  function renderChatCard(chat) {
    const card = document.createElement('div');
    card.className = 'chat-card';
    card.dataset.jid = chat.jid;

    // Header
    const header = document.createElement('div');
    header.className = 'chat-card-header';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'chat-name';
    nameSpan.textContent = chat.name || chat.jid.split('@')[0];
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
    msgCount.textContent = `${chat.message_count || 0} msgs`;
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

    // Body
    const body = document.createElement('div');
    body.className = 'chat-card-body';

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
    table.appendChild(tbody);
    body.appendChild(table);

    // Load more button
    const loadMore = document.createElement('button');
    loadMore.className = 'load-more';
    loadMore.textContent = 'Load messages';
    loadMore.addEventListener('click', () => loadMessagesForChat(chat.jid, tbody, loadMore));
    body.appendChild(loadMore);

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

    // Sender
    const tdSender = document.createElement('td');
    tdSender.className = 'col-sender sender-cell';
    const senderText = msg.sender_name || (msg.sender_jid ? msg.sender_jid.split('@')[0] : 'Unknown');
    tdSender.textContent = senderText;
    if (msg.sender_jid) {
      const tooltip = document.createElement('span');
      tooltip.className = 'tooltip';
      tooltip.textContent = msg.sender_jid;
      tdSender.appendChild(tooltip);
    }
    tr.appendChild(tdSender);

    // Content
    const tdContent = document.createElement('td');
    tdContent.className = 'col-content';
    tdContent.textContent = msg.content || '';
    // Inline image if media downloaded
    if (msg.media_path && msg.media_type === 'image') {
      const chatJid = msg.chat_jid.replace(/[/:]/g, '_');
      const img = document.createElement('img');
      img.className = 'inline-media';
      img.src = `/api/media/${encodeURIComponent(chatJid)}/${encodeURIComponent(msg.id)}`;
      img.alt = 'image';
      img.loading = 'lazy';
      tdContent.appendChild(img);
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
  // D. Pagination
  // -------------------------------------------------------
  async function loadMessagesForChat(jid, tbody, loadMoreBtn) {
    const page = (chatPages[jid] || 0) + 1;
    chatPages[jid] = page;

    loadMoreBtn.disabled = true;
    loadMoreBtn.textContent = 'Loading...';

    const result = await fetchMessages(jid, page, 100);
    const offset = (page - 1) * 100;

    for (let i = 0; i < result.messages.length; i++) {
      const row = renderMessageRow(result.messages[i], offset + i);
      tbody.appendChild(row);
    }

    const loaded = offset + result.messages.length;
    if (loaded >= result.total) {
      loadMoreBtn.textContent = `All ${result.total} messages loaded`;
      loadMoreBtn.disabled = true;
    } else {
      loadMoreBtn.textContent = `Load more (${loaded}/${result.total})`;
      loadMoreBtn.disabled = false;
    }
  }

  // -------------------------------------------------------
  // E. Initialization
  // -------------------------------------------------------
  async function loadChats() {
    const chats = await fetchChats();
    chatCardsContainer.innerHTML = '';

    for (const chat of chats) {
      const card = renderChatCard(chat);
      chatCardsContainer.appendChild(card);
    }

    // Update progress
    progressBar.style.width = '100%';
    setTimeout(() => {
      progressBarContainer.classList.remove('active');
      progressBar.style.width = '0%';
    }, 2000);

    fetchStatus();

    // Auto-refresh chats periodically during sync
    if (isConnected) {
      setTimeout(loadChats, 15000);
    }
  }

  // Boot
  fetchStatus().catch(() => {});
  connectWebSocket();
})();
