/* TangShiYe 浮窗 Renderer */
(() => {
  'use strict';

  // marked 已通过 <script> 注入到 window.marked
  const marked = window.marked;
  if (marked && typeof marked.setOptions === 'function') {
    marked.setOptions({ breaks: true, gfm: true });
  }

  const $ = (id) => document.getElementById(id);

  const els = {
    card:         $('card'),
    titleCode:    $('title-code'),
    offlineBadge: $('offline-badge'),
    btnPin:       $('btn-pin'),
    btnClose:     $('btn-close'),

    statusEmpty:  $('status-empty'),
    statusLoading:$('status-loading'),
    statusError:  $('status-error'),
    errorText:    $('error-text'),
    loadingText:  $('loading-text'),

    explanation:  $('explanation'),
    detail:       $('detail'),
    detailLbl:    $('detail-line-by-line'),
    lblGrid:      $('line-by-line-grid'),
    lblStat:      $('lbl-stat'),
    lblMode:      $('lbl-mode'),
    lblOverflow:  $('lbl-overflow'),
    lblOverflowText: $('lbl-overflow-text'),
    lblRaw:       $('lbl-raw'),
    btnModeSwitch:$('btn-mode-switch'),
    btnShowAll:   $('btn-show-all'),

    chat:         $('chat'),
    chatMessages: $('chat-messages'),

    actionsQuick: $('actions-quick'),
    btnCopy:      $('btn-copy'),
    btnDetail:    $('btn-detail'),

    chatInputRow: $('chat-input-row'),
    chatInput:    $('chat-input'),
    btnSend:      $('btn-send'),

    toast:        $('toast'),
  };

  // ── 状态 ──
  let currentCode = '';
  let viewMode = 'empty';   // empty | quick | detail
  let isLoading = false;    // 任何 LLM 调用进行中
  let streamingMsg = null;  // 当前流式 AI 消息 DOM（追问）
  let streamingBuf = '';    // 追问当前流式缓冲
  let quickBuf = '';        // 速览流式缓冲
  let detailBuf = '';       // 详解流式缓冲
  let detailRenderMode = 'segmented';  // 详解当前显示模式
  let currentLineByLineData = null;     // {lines:[], raw:'', total:N, showAll:false}
  let detailLineLimit = 50;             // 超过此行数默认折叠
  let isOffline = false;                // 离线模式（本地规则引擎，不联网）

  function setOffline(on) {
    isOffline = !!on;
    els.offlineBadge.classList.toggle('hidden', !isOffline);
    els.chatInput.placeholder = isOffline
      ? '离线模式不支持追问（可关闭托盘里的离线模式）'
      : '追问任何细节…';
    els.chatInput.disabled = isOffline;
    els.btnSend.disabled = isOffline;
  }

  // 内容变化后通知主进程 auto-fit 窗口高度（rAF 防抖）
  let _autosizeRaf = 0;
  function requestAutosize() {
    if (_autosizeRaf) cancelAnimationFrame(_autosizeRaf);
    _autosizeRaf = requestAnimationFrame(() => {
      _autosizeRaf = 0;
      const titlebar = els.card.querySelector('.titlebar');
      const content  = $('content');
      const footer   = els.card.querySelector('.footer');
      let h = 2;
      if (titlebar) h += titlebar.offsetHeight;
      if (content)  h += content.scrollHeight;
      if (footer)   h += footer.offsetHeight;
      window.whisper.autosize(Math.ceil(h));
    });
  }

  // ── 视图切换 ──
  function setView(mode) {
    viewMode = mode;
    els.statusEmpty.classList.toggle('hidden', mode !== 'empty');
    els.statusError.classList.add('hidden');
    els.explanation.classList.toggle('hidden', mode === 'empty' || mode === 'loading-only');
    // detail 容器按 detailRenderMode 决定显示哪个
    const isDetail = mode === 'detail';
    if (isDetail && detailRenderMode === 'lineByLine') {
      els.detail.classList.add('hidden');
      els.detailLbl.classList.remove('hidden');
    } else {
      els.detail.classList.toggle('hidden', !isDetail);
      els.detailLbl.classList.add('hidden');
    }
    els.chat.classList.toggle('hidden', !isDetail);
    els.actionsQuick.classList.toggle('hidden', isDetail);
    els.chatInputRow.classList.toggle('hidden', !isDetail);
    requestAutosize();
  }

  function setLoading(on, text) {
    isLoading = on;
    els.statusLoading.classList.toggle('hidden', !on);
    if (text) els.loadingText.textContent = text;
    els.btnDetail.disabled = on;
    els.btnSend.disabled = on || isOffline;
    els.chatInput.disabled = on || isOffline;
  }

  function showError(message) {
    if (els.errorText) {
      els.errorText.textContent = message;
    } else {
      els.statusError.textContent = message;
    }
    els.statusError.classList.remove('hidden');
    setLoading(false);
    requestAutosize();
  }

  // ── 内容渲染 ──
  function renderMarkdown(target, text) {
    if (marked && typeof marked.parse === 'function') {
      try {
        target.innerHTML = marked.parse(text || '');
        return;
      } catch (e) {
        console.error('Markdown 渲染失败:', e);
      }
    }
    target.textContent = text || '';
  }

  // ── 逐行注释渲染 ──
  function renderLineByLine(lines, raw) {
    const grid = els.lblGrid;
    grid.innerHTML = '';
    if (!Array.isArray(lines) || lines.length === 0) {
      // 解析失败：降级显示原始内容
      if (raw) {
        els.lblRaw.textContent = raw;
        els.lblRaw.classList.remove('hidden');
      } else {
        const empty = document.createElement('div');
        empty.className = 'line-by-line-empty';
        empty.textContent = '（未获取到逐行解释）';
        grid.appendChild(empty);
      }
      els.lblStat.textContent = '0 / 0 行';
      els.lblOverflow.classList.add('hidden');
      return;
    }
    els.lblRaw.classList.add('hidden');

    const total = lines.length;
    const data = currentLineByLineData = { lines, raw: raw || '', total, showAll: total <= detailLineLimit };
    paintLineByLine();
  }

  function paintLineByLine() {
    const data = currentLineByLineData;
    if (!data) return;
    const grid = els.lblGrid;
    grid.innerHTML = '';
    const visible = data.showAll ? data.lines : data.lines.slice(0, detailLineLimit);

    visible.forEach((ln, idx) => {
      const row = document.createElement('div');
      row.className = 'line-row';
      row.style.setProperty('--row-delay', (idx * 18) + 'ms');

      const cellNum = document.createElement('div');
      cellNum.className = 'line-num';
      cellNum.textContent = String(ln.n != null ? ln.n : (idx + 1));

      const cellCode = document.createElement('div');
      cellCode.className = 'line-code';
      // code 字段保留原文本（包括空格/缩进）
      const codeText = document.createElement('pre');
      codeText.textContent = String(ln.code != null ? ln.code : '');
      cellCode.appendChild(codeText);

      const cellExp = document.createElement('div');
      cellExp.className = 'line-exp';
      if (ln.kind) cellExp.dataset.kind = ln.kind;
      cellExp.textContent = String(ln.explain != null ? ln.explain : '');

      row.appendChild(cellNum);
      row.appendChild(cellCode);
      row.appendChild(cellExp);
      grid.appendChild(row);
    });

    els.lblStat.textContent = `${visible.length} / ${data.total} 行`;

    // 折叠提示
    if (!data.showAll && data.total > detailLineLimit) {
      els.lblOverflowText.textContent = `共 ${data.total} 行,仅显示前 ${detailLineLimit} 行`;
      els.lblOverflow.classList.remove('hidden');
    } else {
      els.lblOverflow.classList.add('hidden');
    }
    requestAutosize();
  }

  // ── 视图入口 ──
  function showQuick(payload) {
    const code = (payload && payload.code) || '';
    const explanation = (payload && payload.explanation) || '';
    setOffline(!!(payload && payload.offline));
    currentCode = code;
    els.titleCode.textContent = code || '（无代码）';
    els.titleCode.title = code;
    quickBuf = explanation;
    renderMarkdown(els.explanation, explanation);
    els.explanation.classList.toggle('streaming', false);
    els.detail.innerHTML = '';
    els.detailLbl.classList.add('hidden');
    els.chatMessages.innerHTML = '';
    streamingMsg = null;
    streamingBuf = '';
    detailBuf = '';
    currentLineByLineData = null;
    if (!explanation) els.explanation.classList.add('streaming');
    setLoading(false);
    setView('quick');
    requestAutosize();
  }

  function handleQuickChunk(payload) {
    const text = (payload && payload.text) || '';
    if (!text) return;
    setLoading(false);
    quickBuf += text;
    renderMarkdown(els.explanation, quickBuf);
    els.explanation.classList.add('streaming');
    requestAutosize();
  }

  function handleQuickComplete() {
    els.explanation.classList.remove('streaming');
    setLoading(false);
    requestAutosize();
  }

  function showDetail(payload) {
    const mode = (payload && payload.mode) || 'segmented';
    if (payload && typeof payload.offline === 'boolean') setOffline(payload.offline);
    detailRenderMode = mode;

    if (mode === 'lineByLine') {
      const lines = (payload && payload.lines) || [];
      const raw = (payload && payload.raw) || '';
      renderLineByLine(lines, raw);
      els.btnModeSwitch.textContent = '⇄ 拆解';
      els.btnModeSwitch.title = '切换到拆解模式';
      els.lblMode.textContent = '📋 逐行';
      setView('detail');
    } else {
      const content = (payload && payload.content) || '';
      detailBuf = content;
      renderMarkdown(els.detail, content);
      els.detail.classList.toggle('streaming', !content);
      setView('detail');
    }
    setLoading(false);
    window.whisper.expandForDetail();
    requestAutosize();
    setTimeout(() => els.chatInput.focus(), 80);
  }

  function handleDetailChunk(payload) {
    const text = (payload && payload.text) || '';
    if (!text) return;
    setLoading(false);
    detailBuf += text;
    renderMarkdown(els.detail, detailBuf);
    els.detail.classList.add('streaming');
    requestAutosize();
  }

  function handleDetailComplete(payload) {
    const mode = (payload && payload.mode) || detailRenderMode;
    if (mode === 'lineByLine') {
      // lineByLine 模式: 完成时整体出现(在 showDetail 已处理),这里只关 loading 和聚焦
      els.lblGrid.classList.remove('streaming');
    } else {
      els.detail.classList.remove('streaming');
    }
    setLoading(false);
    requestAutosize();
    setTimeout(() => els.chatInput.focus(), 50);
  }

  function handleModeChanged(payload) {
    const mode = (payload && payload.mode);
    if (mode !== 'segmented' && mode !== 'lineByLine') return;
    detailRenderMode = mode;
    // 模式刚切 → 自动重发一次详解请求,免去用户多点一次
    if (currentCode) {
      setLoading(true, '切换模式 · 重新生成');
      window.whisper.requestDetail();
    }
  }

  // ── 追问 ──
  function appendChatMessage(role, text) {
    const msg = document.createElement('div');
    msg.className = `msg msg-${role}`;
    if (role === 'ai') {
      msg.classList.add('markdown');
      renderMarkdown(msg, text);
    } else {
      msg.textContent = text;
    }
    els.chatMessages.appendChild(msg);
    msg.scrollIntoView({ behavior: 'smooth', block: 'end' });
    return msg;
  }

  function handleChatChunk(payload) {
    const text = (payload && payload.text) || '';
    if (!streamingMsg) {
      streamingMsg = appendChatMessage('ai', '');
      streamingMsg.classList.add('streaming');
      streamingBuf = '';
      setLoading(false);
    }
    streamingBuf += text;
    renderMarkdown(streamingMsg, streamingBuf);
    streamingMsg.classList.add('streaming');
    els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
    requestAutosize();
  }

  function handleChatComplete() {
    if (streamingMsg) {
      streamingMsg.classList.remove('streaming');
      streamingMsg = null;
      streamingBuf = '';
    }
    setLoading(false);
    requestAutosize();
    setTimeout(() => els.chatInput.focus(), 50);
  }

  // ── Toast ──
  let toastTimer = 0;
  function showToast(text) {
    els.toast.textContent = text;
    els.toast.classList.remove('hidden');
    els.toast.style.animation = 'none';
    void els.toast.offsetWidth;
    els.toast.style.animation = '';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.add('hidden'), 1500);
  }

  // ── 事件 ──
  els.btnClose.addEventListener('click', () => window.whisper.close());

  els.btnPin.addEventListener('click', () => window.whisper.togglePin());

  els.btnCopy.addEventListener('click', () => {
    if (currentCode) {
      window.whisper.copy(currentCode);
      showToast('已复制');
    }
  });

  els.btnDetail.addEventListener('click', () => {
    if (isLoading || !currentCode) return;
    setLoading(true, '生成详解');
    window.whisper.requestDetail();
  });

  /** 模式切换按钮：在 lineByLine → segmented 或反过来，通知主进程持久化并重发请求 */
  els.btnModeSwitch.addEventListener('click', () => {
    if (isLoading || !currentCode) return;
    const newMode = detailRenderMode === 'lineByLine' ? 'segmented' : 'lineByLine';
    window.whisper.switchMode(newMode);
  });

  /** 展开全部行（超过 detailLineLimit 时） */
  els.btnShowAll.addEventListener('click', () => {
    if (currentLineByLineData) {
      currentLineByLineData.showAll = true;
      paintLineByLine();
    }
  });

  function sendChat() {
    const text = els.chatInput.value.trim();
    if (!text || isLoading) return;
    appendChatMessage('user', text);
    requestAutosize();
    els.chatInput.value = '';
    setLoading(true, '思考中');
    window.whisper.sendChat(text);
  }

  els.btnSend.addEventListener('click', sendChat);

  els.chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendChat();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (document.activeElement === els.chatInput) {
        els.chatInput.blur();
      } else {
        window.whisper.close();
      }
    }
  });

  // ── IPC ──
  window.whisper.onShowQuick(showQuick);
  window.whisper.onQuickChunk(handleQuickChunk);
  window.whisper.onQuickComplete(handleQuickComplete);
  window.whisper.onShowDetail(showDetail);
  window.whisper.onDetailChunk(handleDetailChunk);
  window.whisper.onDetailComplete(handleDetailComplete);
  window.whisper.onModeChanged(handleModeChanged);
  window.whisper.onLoading(() => setLoading(true, '解读中'));
  window.whisper.onError((p) => showError((p && p.message) || '未知错误'));
  window.whisper.onChatChunk(handleChatChunk);
  window.whisper.onChatComplete(handleChatComplete);
  window.whisper.onPinState(({ pinned }) => {
    els.btnPin.classList.toggle('active', !!pinned);
    els.btnPin.title = pinned ? '已固定（点击取消）' : '固定窗口';
  });
  window.whisper.onOfflineState((p) => setOffline(!!(p && p.offline)));

  setView('empty');
})();
