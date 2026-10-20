import { BrowserWindow, screen, app, ipcMain } from 'electron';
import * as path from 'path';
import { getConfig } from './store';

const DEFAULT_WIDTH = 400;
const DEFAULT_WIDTH_LINE_BY_LINE = 600;  // 逐行模式三列需要更宽
const DEFAULT_HEIGHT = 180;       // 初始高度（内容到达前的占位）
const MIN_WIDTH = 280;
const MIN_HEIGHT = 80;
const SCREEN_MAX_RATIO = 0.85;    // 屏幕硬上限：工作区 85%

let popup: BrowserWindow | null = null;
let isPinned = false;

/**
 * 尺寸记忆策略：
 *   - 宽度：由用户手动拖动控制，跨触发持久（userPreferredWidth）
 *   - 高度：始终自适应内容（renderer 测 scrollHeight → 主进程 setSize）
 *   - 详解视图下用户手动拖过高度 → 该值作为高度上限（detailMaxHeight），
 *     超过则不再 setSize，由内容区 overflow:auto 自动滚动
 *   - 速览视图下用户拖高度：忽略（auto-fit 会覆盖）
 */
let userPreferredWidth: number | null = null;
let detailMaxHeight: number | null = null;
let currentView: 'quick' | 'detail' = 'quick';

export interface PopupPayload {
  code: string;
  explanation?: string;
  /** 离线模式标记（透传至 renderer 用于显示徽章） */
  offline?: boolean;
}

export function createPopup(): BrowserWindow {
  if (popup && !popup.isDestroyed()) return popup;

  const isLinux = process.platform === 'linux';

  popup = new BrowserWindow({
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    frame: false,
    transparent: !isLinux,
    backgroundColor: isLinux ? '#ffffff' : '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    movable: true,
    show: false,
    focusable: true,
    hasShadow: true,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    thickFrame: true,
    webPreferences: {
      preload: path.join(app.getAppPath(), 'dist', 'preload', 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  popup.setAlwaysOnTop(true, 'pop-up-menu');
  popup.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const htmlPath = path.join(app.getAppPath(), 'src', 'renderer', 'popup', 'index.html');
  popup.loadFile(htmlPath).catch((err: Error) => {
    console.error('[汤师爷] 加载浮窗 HTML 失败:', err);
  });

  popup.on('blur', () => {
    if (!isPinned && popup && popup.isVisible()) {
      hidePopup();
    }
  });

  // OS thickFrame 的原生 resize 完成时触发（programmatic setSize 不会触发）
  popup.on('resized', () => {
    if (!popup || popup.isDestroyed()) return;
    const [w, h] = popup.getSize();
    userPreferredWidth = w;
    console.log(`[Resize/OS] saved width=${w} (view=${currentView}, h=${h})`);
    if (currentView === 'detail') {
      detailMaxHeight = h;
      console.log(`[Resize/OS] saved detailMaxHeight=${h}`);
    }
  });

  popup.on('closed', () => {
    popup = null;
  });

  return popup;
}

export function getPopup(): BrowserWindow | null {
  return popup;
}

function getScreenMaxHeight(): number {
  if (!popup || popup.isDestroyed()) return 800;
  const display = screen.getDisplayMatching(popup.getBounds());
  return Math.floor(display.workArea.height * SCREEN_MAX_RATIO);
}

function computePosition(width: number, height: number): { x: number; y: number } {
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const { x: dx, y: dy, width: dw, height: dh } = display.workArea;

  let x = cursor.x + 12;
  let y = cursor.y + 12;

  if (x + width > dx + dw) x = cursor.x - width - 12;
  if (y + height > dy + dh) y = cursor.y - height - 12;

  if (x < dx) x = dx + 8;
  if (y < dy) y = dy + 8;

  return { x: Math.round(x), y: Math.round(y) };
}

export function showPopupAtCursor(payload: PopupPayload): void {
  const win = createPopup();

  const send = (): void => {
    if (!win || win.isDestroyed()) return;
    currentView = 'quick';
    // 逐行模式三列布局需要更宽的默认宽度
    const cfg = getConfig();
    const baseWidth = cfg.detailMode === 'lineByLine' ? DEFAULT_WIDTH_LINE_BY_LINE : DEFAULT_WIDTH;
    const width  = userPreferredWidth ?? baseWidth;
    console.log(`[Show] using width=${width} (saved=${userPreferredWidth}, base=${baseWidth}, mode=${cfg.detailMode})`);
    // 高度先用默认作占位，内容到达后会 auto-fit
    win.setSize(width, DEFAULT_HEIGHT, false);
    const pos = computePosition(width, DEFAULT_HEIGHT);
    win.setPosition(pos.x, pos.y, false);
    win.showInactive();
    win.focus();
    win.webContents.send('whisper:show-quick', payload);
  };

  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', send);
  } else {
    send();
  }
}

export function hidePopup(): void {
  if (popup && !popup.isDestroyed() && popup.isVisible()) {
    popup.hide();
    isPinned = false;
  }
}

/**
 * Renderer 通知主进程：内容自然高度变化了，请 auto-fit。
 *   - 详解视图下若用户设过 detailMaxHeight，最多到那个高度（再多就 scroll）
 *   - 始终被屏幕硬上限（85% 工作区）夹住
 */
export function autosizeToContent(contentHeight: number): void {
  if (!popup || popup.isDestroyed()) return;
  const [w, currentH] = popup.getSize();
  const screenMax = getScreenMaxHeight();

  let target = Math.max(MIN_HEIGHT, Math.ceil(contentHeight));
  if (currentView === 'detail' && detailMaxHeight !== null) {
    target = Math.min(target, detailMaxHeight);
  }
  target = Math.min(target, screenMax);

  if (target === currentH) return;
  popup.setSize(w, target, false);
}

/** Renderer 切到详解视图：更新 view 状态；lineByLine 模式自动加宽 */
export function markDetailView(): void {
  currentView = 'detail';
  if (popup && !popup.isDestroyed() && !userPreferredWidth) {
    const cfg = getConfig();
    if (cfg.detailMode === 'lineByLine') {
      const [, h] = popup.getSize();
      popup.setSize(DEFAULT_WIDTH_LINE_BY_LINE, h, false);
      console.log(`[Detail] lineByLine mode auto-resize width → ${DEFAULT_WIDTH_LINE_BY_LINE}`);
    }
  }
}

export function togglePin(): boolean {
  isPinned = !isPinned;
  return isPinned;
}

// 注册 IPC（renderer → main）
ipcMain.on('whisper:close', () => hidePopup());
ipcMain.on('whisper:toggle-pin', (event) => {
  const pinned = togglePin();
  event.sender.send('whisper:pin-state', { pinned });
});
ipcMain.on('whisper:expand-for-detail', () => {
  markDetailView();
});
ipcMain.on('whisper:autosize', (_event, { height }: { height: number }) => {
  autosizeToContent(height);
});
