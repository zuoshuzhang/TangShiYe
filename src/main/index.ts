import { app, BrowserWindow, ipcMain, clipboard } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { initTray, destroyTray } from './tray';
import { openSettingsWindow, initSettingsIpc } from './settingsWindow';
import { createPopup, showPopupAtCursor, hidePopup, getPopup } from './windowManager';
import { startKeyListener, stopKeyListener } from './keyListener';
import { acquireSelectedCode } from './codeAcquisition';
import { detectLanguage, Language } from './languageDetector';
import { quickExplain, detailedExplain, lineByLineExplain, chat, OpenAIProviderError } from './llm/llmService';
import { getConfig, getConfigPath, setConfig, PROVIDER_PRESETS } from './store';
import { cacheGet, cacheSet, cacheStats } from './cache';
import { explainOffline, quickExplainOffline } from './offline/engine';

/**
 * GPU 兜底（仅调试/无显卡环境用）。
 *
 * 某些环境（虚拟机、远程桌面、老显卡驱动、CI 容器）GPU 进程会反复崩溃，
 * 最终 FATAL:gpu_data_manager_impl_private.cc(448) GPU process isn't usable
 * 把整个应用带走 —— 表现为启动就闪退，且没有任何弹窗。
 *
 * 这个浮窗只做 2D 文本渲染，软件渲染完全够用。所以给一个开关：
 *   TSY_DISABLE_GPU=1  → 关闭硬件加速（必须在 app ready 之前设置）
 * 默认不开，避免影响正常机器上的透明窗口观感。
 */
if (process.env.TSY_DISABLE_GPU === '1') {
  app.disableHardwareAcceleration();
  // 光 disableHardwareAcceleration 不够：Electron 仍会起 GPU 子进程做合成，
  // 该子进程在本环境里连软件渲染都崩。把 GPU 塞进主进程，崩也只崩一个线程。
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.commandLine.appendSwitch('in-process-gpu');
  app.commandLine.appendSwitch('disable-software-rasterizer');
  console.log('[汤师爷] TSY_DISABLE_GPU=1：已关闭硬件加速 + GPU 进程内联（软件渲染）');
}

/**
 * 配置迁移：把旧 userData 目录里的 config.json 搬到当前目录。
 *
 * 背景：Electron 的 userData 目录名跟随 productName，项目一改名目录就换，
 * 不做迁移的话用户配好的 API Key / 模型会凭空消失。
 * 本项目先后用过 codewhisper、WTF-Zh-Ol 两个名字，现名 TangShiYe。
 *
 * 规则：按 LEGACY_DIRS 顺序取第一个存在的旧目录；
 *      当前目录已有非空 apiKey 时不动（用户已在新版本配过了）。
 * 必须在任何 electron-store 调用之前执行（否则 store 会先创建空 config 把迁移路径堵死）。
 * 不调用 getConfigPath/getConfig；用 fs 自己定位路径。
 */
const LEGACY_DIRS = ['WTF-Zh-Ol', 'codewhisper'];

function migrateLegacyConfig(): void {
  try {
    const userData = app.getPath('userData');
    const currentPath = path.join(userData, 'config.json');
    const parentDir = path.dirname(userData);

    let legacyPath: string | null = null;
    for (const dir of LEGACY_DIRS) {
      const p = path.join(parentDir, dir, 'config.json');
      if (fs.existsSync(p)) { legacyPath = p; break; }
    }
    if (!legacyPath) return;

    if (fs.existsSync(currentPath)) {
      try {
        const cur = JSON.parse(fs.readFileSync(currentPath, 'utf8'));
        if (cur && typeof cur.apiKey === 'string' && cur.apiKey.length > 0) return;
        const legacy = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
        if (!legacy || typeof legacy.apiKey !== 'string' || legacy.apiKey.length === 0) return;
        const merged = { ...cur, ...legacy };
        fs.writeFileSync(currentPath, JSON.stringify(merged, null, 2), 'utf8');
        console.log(`[汤师爷] 已从旧目录 ${path.basename(path.dirname(legacyPath))} 把配置补到 ${currentPath}`);
      } catch (e) {
        console.warn('[汤师爷] 旧配置解析失败，跳过迁移:', (e as Error).message);
      }
      return;
    }
    fs.mkdirSync(path.dirname(currentPath), { recursive: true });
    fs.copyFileSync(legacyPath, currentPath);
    console.log(`[汤师爷] 已从旧名字目录迁移配置: ${legacyPath} → ${currentPath}`);
  } catch (e) {
    console.warn('[汤师爷] 配置迁移失败（不影响启动）:', (e as Error).message);
  }
}

// 单实例锁
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

// ── 运行时状态 ──
let isEnabled = true;

interface CurrentContext {
  code: string;
  language: Language;
  detailMode: 'segmented' | 'lineByLine';
  detailSegmented?: string;             // 缓存 segmented 详解 markdown
  detailLineByLine?: { lines: any[]; raw: string };  // 缓存 lineByLine JSON
  chatHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
}

let current: CurrentContext | null = null;
let activeAbort: AbortController | null = null;

function setEnabled(value: boolean): void {
  isEnabled = value;
  console.log('[汤师爷] 监听状态:', value ? '已启用' : '已暂停');
}

function abortPrevious(): void {
  if (activeAbort) {
    activeAbort.abort();
    activeAbort = null;
  }
}

function sendToPopup(channel: string, payload?: unknown): void {
  const win = getPopup();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(channel, payload);
}

function describeError(err: unknown): string {
  if (err instanceof OpenAIProviderError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

// ─────────────── 触发主流程 ───────────────
async function triggerExplain(): Promise<void> {
  if (!isEnabled) {
    console.log('[汤师爷] 已暂停，忽略触发');
    return;
  }
  console.log('[汤师爷] 触发解读');

  abortPrevious();

  const acquired = await acquireSelectedCode();
  if (!acquired) {
    showPopupAtCursor({
      code: '',
      explanation: '⚠️ 剪贴板为空。请先选中并 Ctrl+C 复制代码，再双击 Ctrl 触发。',
    });
    return;
  }

  const code = acquired.code;
  const language = detectLanguage(code);
  const cfg = getConfig();
  const detailMode = cfg.detailMode;
  const offline = cfg.offlineMode;
  console.log(`[汤师爷] 代码 ${code.length} 字符, 语言=${language}, detailMode=${detailMode}, offline=${offline}`);

  current = { code, language, detailMode, chatHistory: [] };

  // 1) 弹出（清空 UI，准备接收流式内容）
  showPopupAtCursor({ code, explanation: '', offline });

  // 2) 离线模式：直接走本地规则引擎（零网络、零延迟）
  if (offline) {
    const explanation = quickExplainOffline(code, language);
    console.log(`[汤师爷] 离线速览完成, ${explanation.length} 字`);
    sendToPopup('whisper:show-quick', { code, explanation, offline: true });
    sendToPopup('whisper:quick-complete');
    return;
  }

  // 3) 缓存命中直接显示
  const cached = cacheGet(code, language, 'quick');
  if (cached) {
    console.log('[汤师爷] 速览命中缓存');
    sendToPopup('whisper:show-quick', { code, explanation: cached });
    sendToPopup('whisper:quick-complete');
    return;
  }

  // 4) 流式调用 LLM 速览
  sendToPopup('whisper:loading');
  const ctrl = new AbortController();
  activeAbort = ctrl;
  const tStart = Date.now();
  let firstChunkAt = 0;
  try {
    const explanation = await quickExplain({
      code, language, signal: ctrl.signal,
      onChunk: (text) => {
        if (!firstChunkAt) {
          firstChunkAt = Date.now();
          console.log(`[汤师爷] 速览首字节 ${firstChunkAt - tStart}ms`);
        }
        sendToPopup('whisper:quick-chunk', { text });
      },
    });
    if (ctrl.signal.aborted) return;
    console.log(`[汤师爷] 速览完成 ${Date.now() - tStart}ms, 共 ${explanation.length} 字`);
    cacheSet(code, language, 'quick', explanation);
    sendToPopup('whisper:quick-complete');
  } catch (err) {
    if (ctrl.signal.aborted) return;
    const msg = describeError(err);
    console.error('[汤师爷] 速览失败:', msg);
    sendToPopup('whisper:error', { message: msg });
  } finally {
    if (activeAbort === ctrl) activeAbort = null;
  }
}

// ─────────────── 详解请求（按 mode 分支） ───────────────
async function handleRequestDetail(): Promise<void> {
  if (!current) return;
  const mode = current.detailMode;
  const offline = getConfig().offlineMode;

  // 离线模式：直接走规则引擎（lineByLine 走结构化 lines，segmented 走 summary markdown）
  if (offline) {
    const tStart = Date.now();
    const result = explainOffline(current.code, current.language);
    console.log(`[汤师爷] 离线详解完成 mode=${mode} ${Date.now() - tStart}ms, ${result.matched}/${result.total} 行命中`);
    if (mode === 'lineByLine') {
      sendToPopup('whisper:show-detail', { mode, lines: result.lines, raw: '', offline: true });
    } else {
      sendToPopup('whisper:show-detail', { content: result.summary, mode, offline: true });
    }
    sendToPopup('whisper:detail-complete', { mode });
    return;
  }

  // 本会话已有缓存
  if (mode === 'segmented' && current.detailSegmented) {
    sendToPopup('whisper:show-detail', { content: current.detailSegmented, mode });
    return;
  }
  if (mode === 'lineByLine' && current.detailLineByLine) {
    sendToPopup('whisper:show-detail', { mode, lines: current.detailLineByLine.lines, raw: current.detailLineByLine.raw });
    return;
  }
  // 跨会话 LRU 缓存
  const cached = cacheGet(current.code, current.language, 'detail', mode);
  if (cached) {
    console.log(`[汤师爷] 详解命中缓存 mode=${mode}`);
    if (mode === 'segmented') {
      current.detailSegmented = cached;
      sendToPopup('whisper:show-detail', { content: cached, mode });
    } else {
      try {
        const lines = JSON.parse(cached);
        current.detailLineByLine = { lines, raw: '' };
        sendToPopup('whisper:show-detail', { mode, lines, raw: '' });
      } catch {
        sendToPopup('whisper:show-detail', { mode, lines: [], raw: cached });
      }
    }
    return;
  }

  // 切到详解视图
  if (mode === 'lineByLine') {
    sendToPopup('whisper:show-detail', { mode, lines: [], raw: '' });
  } else {
    sendToPopup('whisper:show-detail', { content: '', mode });
  }
  sendToPopup('whisper:loading');

  const ctrl = new AbortController();
  abortPrevious();
  activeAbort = ctrl;
  const tStart = Date.now();

  try {
    if (mode === 'segmented') {
      // 流式 markdown
      let firstChunkAt = 0;
      const content = await detailedExplain({
        code: current.code,
        language: current.language,
        signal: ctrl.signal,
        onChunk: (text) => {
          if (!firstChunkAt) {
            firstChunkAt = Date.now();
            console.log(`[汤师爷] 详解首字节 ${firstChunkAt - tStart}ms`);
          }
          sendToPopup('whisper:detail-chunk', { text });
        },
      });
      if (ctrl.signal.aborted) return;
      console.log(`[汤师爷] segmented 详解完成 ${Date.now() - tStart}ms, ${content.length} 字`);
      if (current) current.detailSegmented = content;
      cacheSet(current!.code, current!.language, 'detail', content, 'segmented');
      sendToPopup('whisper:detail-complete', { mode });
    } else {
      // 非流式 JSON
      const result = await lineByLineExplain({
        code: current.code,
        language: current.language,
        signal: ctrl.signal,
      });
      if (ctrl.signal.aborted) return;
      console.log(`[汤师爷] lineByLine 详解完成 ${Date.now() - tStart}ms, 解析 ${result.lines.length} 行`);
      if (current) current.detailLineByLine = result;
      cacheSet(current!.code, current!.language, 'detail', JSON.stringify(result.lines), 'lineByLine');
      sendToPopup('whisper:show-detail', { mode, lines: result.lines, raw: result.lines.length === 0 ? result.raw : '' });
      sendToPopup('whisper:detail-complete', { mode });
    }
  } catch (err) {
    if (ctrl.signal.aborted) return;
    const msg = describeError(err);
    console.error(`[汤师爷] 详解失败 mode=${mode}:`, msg);
    sendToPopup('whisper:error', { message: msg });
  } finally {
    if (activeAbort === ctrl) activeAbort = null;
  }
}

// ─────────────── 追问 ───────────────
async function handleChat(text: string): Promise<void> {
  if (!current) {
    sendToPopup('whisper:error', { message: '当前没有解读上下文' });
    return;
  }
  if (getConfig().offlineMode) {
    sendToPopup('whisper:error', { message: '离线模式不支持追问（语义追问需要 AI）。请在托盘里关闭离线模式。' });
    return;
  }
  const userMsg = (text || '').trim();
  if (!userMsg) return;

  current.chatHistory.push({ role: 'user', content: userMsg });

  const MAX_HISTORY = 20;
  if (current.chatHistory.length > MAX_HISTORY) {
    current.chatHistory = current.chatHistory.slice(-MAX_HISTORY);
  }

  const ctrl = new AbortController();
  abortPrevious();
  activeAbort = ctrl;

  let assistantBuf = '';
  try {
    await chat({
      code: current.code,
      language: current.language,
      history: current.chatHistory,
      signal: ctrl.signal,
      onChunk: (chunk) => {
        assistantBuf += chunk;
        sendToPopup('whisper:chat-chunk', { text: chunk });
      },
    });
    if (current) current.chatHistory.push({ role: 'assistant', content: assistantBuf });
    sendToPopup('whisper:chat-complete');
  } catch (err) {
    if (ctrl.signal.aborted) return;
    const msg = describeError(err);
    console.error('[汤师爷] 追问失败:', msg);
    sendToPopup('whisper:error', { message: msg });
  } finally {
    if (activeAbort === ctrl) activeAbort = null;
  }
}

// ─────────────── IPC 注册 ───────────────
ipcMain.on('whisper:request-detail', () => {
  void handleRequestDetail();
});

ipcMain.on('whisper:send-chat', (_e, { text }: { text: string }) => {
  void handleChat(text);
});

ipcMain.on('whisper:copy', (_e, { text }: { text: string }) => {
  if (typeof text === 'string' && text.length > 0) clipboard.writeText(text);
});

/** 浮窗模式切换请求（lineByLine ⇄ segmented），热生效（仅影响后续详解请求） */
ipcMain.on('whisper:switch-mode', (_e, { mode }: { mode: 'segmented' | 'lineByLine' }) => {
  if (mode !== 'segmented' && mode !== 'lineByLine') return;
  if (current) current.detailMode = mode;
  setConfig({ detailMode: mode });
  console.log(`[汤师爷] 切换详解模式 → ${mode}`);
  sendToPopup('whisper:mode-changed', { mode });
});

/** 离线模式开关：true=走规则引擎（不联网），false=走 LLM */
ipcMain.on('whisper:toggle-offline', (_e, { offline }: { offline: boolean }) => {
  setConfig({ offlineMode: !!offline });
  console.log(`[汤师爷] 离线模式 → ${offline ? '开（规则引擎）' : '关（LLM）'}`);
  sendToPopup('whisper:offline-state', { offline: !!offline });
});

// ─────────────── 启动 ───────────────
app.whenReady().then(() => {
  console.log('[汤师爷] 应用启动');
  migrateLegacyConfig();
  console.log('[汤师爷] 配置文件:', getConfigPath());
  const cfg = getConfig();
  const preset = PROVIDER_PRESETS[cfg.provider];
  console.log(
    `[汤师爷] LLM: provider=${cfg.provider}, baseUrl=${cfg.baseUrl}, model=${cfg.model}, ` +
    `thinking=${cfg.thinking}, apiKey=${cfg.apiKey ? '已设置' : '未设置'}, ` +
    `detailMode=${cfg.detailMode}, offlineMode=${cfg.offlineMode}`
  );
  if (cfg.offlineMode) {
    console.log('[汤师爷] 🔌 离线模式已开启：完全不联网，由本地规则引擎（词典+正则）解释 C / Python');
  } else if (preset?.keyHint) {
    console.log(`[汤师爷] ${preset.keyHint}`);
  }

  createPopup();
  initSettingsIpc();

  // 调试/快捷方式用：带 --open-settings 启动时直接打开设置窗口
  // （也方便做「设置」快捷方式，不用先进托盘再右键）
  if (process.argv.includes('--open-settings')) {
    console.log('[汤师爷] --open-settings：直接打开设置窗口');
    openSettingsWindow();
  }

  initTray({
    isEnabled: () => isEnabled,
    getDetailMode: () => getConfig().detailMode,
    isOffline: () => getConfig().offlineMode,
    onToggleEnabled: setEnabled,
    onToggleDetailMode: (mode) => {
      setConfig({ detailMode: mode });
      if (current) current.detailMode = mode;
      console.log(`[汤师爷] 切换详解模式 → ${mode}`);
      sendToPopup('whisper:mode-changed', { mode });
    },
    onToggleOffline: (offline) => {
      setConfig({ offlineMode: offline });
      console.log(`[汤师爷] 离线模式 → ${offline ? '开（规则引擎）' : '关（LLM）'}`);
      sendToPopup('whisper:offline-state', { offline });
    },
    onTriggerExplain: triggerExplain,
    onOpenSettings: openSettingsWindow,
    onQuit: () => app.quit(),
  });

  const mode = startKeyListener({ onTrigger: triggerExplain });
  console.log('[汤师爷] 键盘监听模式:', mode);
  console.log('[汤师爷] 就绪。' + (mode === 'uiohook'
    ? '选中代码 → Ctrl+C → 双击 Ctrl。'
    : mode === 'fallback'
      ? '降级模式：选中代码 → Ctrl+C → Ctrl+Shift+K。'
      : '键盘监听未启用，仅可从托盘触发。'));

  if (!cfg.apiKey && cfg.provider !== 'ollama' && !cfg.offlineMode) {
    console.warn('[汤师爷] ⚠️ 未配置 API Key。请编辑 ' + getConfigPath() + ' 设置 apiKey，或设置环境变量 ZHIPU_API_KEY / DEEPSEEK_API_KEY。');
    console.warn('[汤师爷]    不想联网？可在托盘里打开「🔌 离线模式」，断网也能逐行解释 C / Python。');
  }
});

app.on('window-all-closed', (e: Event) => {
  e.preventDefault();
});

app.on('before-quit', () => {
  abortPrevious();
  stopKeyListener();
  destroyTray();
});

app.on('second-instance', () => {
  console.log('[汤师爷] 检测到第二个实例尝试启动，已忽略');
});
