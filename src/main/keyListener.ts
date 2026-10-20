/**
 * 全局键盘监听 + 双击 Ctrl 检测。
 *
 * 优先使用 uiohook-napi（真正的全局键盘钩子，能监听单独的 Ctrl 按键），
 * 若加载失败（原生模块未编译/缺失运行时），降级到 globalShortcut
 * 注册 Ctrl+Shift+K 作为触发方式（无法监听单独 Ctrl，但保证可用）。
 */

import { globalShortcut } from 'electron';

const DOUBLE_TAP_THRESHOLD = 300; // ms
const TRIGGER_COOLDOWN = 1000;    // ms 触发后冷却，防止误连击

type Mode = 'uiohook' | 'fallback' | 'none';

let mode: Mode = 'none';
let started = false;
let onTrigger: (() => void) | null = null;

// 双击检测状态机
let lastTapTime = 0;            // 上一次"干净的 Ctrl 单击"完成时间
let ctrlHeld = false;           // 当前是否按住 Ctrl
let otherKeyDuringCtrl = false; // Ctrl 按下后，是否伴随过其他键
let lastTriggerTime = 0;

function maybeTrigger(): void {
  const now = Date.now();
  if (now - lastTriggerTime < TRIGGER_COOLDOWN) return;
  lastTriggerTime = now;
  if (onTrigger) {
    try {
      onTrigger();
    } catch (err) {
      console.error('[KeyListener] 触发回调出错:', err);
    }
  }
}

function handleCtrlDown(): void {
  ctrlHeld = true;
  otherKeyDuringCtrl = false;
}

function handleCtrlUp(): void {
  if (!ctrlHeld) return;
  ctrlHeld = false;
  if (otherKeyDuringCtrl) {
    // 这次是 Ctrl+其他键，不算"轻按"
    otherKeyDuringCtrl = false;
    return;
  }
  // 这是一次"干净"的 Ctrl 轻按
  const now = Date.now();
  if (now - lastTapTime < DOUBLE_TAP_THRESHOLD) {
    lastTapTime = 0; // 重置
    maybeTrigger();
  } else {
    lastTapTime = now;
  }
}

function handleOtherKeyDown(): void {
  if (ctrlHeld) otherKeyDuringCtrl = true;
  // 任意非 Ctrl 单独按键都会"打断"双击节奏
  lastTapTime = 0;
}

function tryStartUiohook(): boolean {
  try {
    // 动态 require，避免编译期硬依赖（防止类型层报错）
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { uIOhook, UiohookKey } = require('uiohook-napi') as {
      uIOhook: {
        on: (event: string, cb: (e: { keycode: number }) => void) => void;
        start: () => void;
        stop: () => void;
      };
      UiohookKey: Record<string, number>;
    };

    const CTRL_LEFT = UiohookKey.Ctrl;        // 左 Ctrl
    const CTRL_RIGHT = UiohookKey.CtrlRight;  // 右 Ctrl（部分版本可能为 CtrlR）
    const ctrlCodes = new Set<number>([CTRL_LEFT, CTRL_RIGHT].filter((v) => typeof v === 'number'));

    uIOhook.on('keydown', (e) => {
      if (ctrlCodes.has(e.keycode)) {
        handleCtrlDown();
      } else {
        handleOtherKeyDown();
      }
    });

    uIOhook.on('keyup', (e) => {
      if (ctrlCodes.has(e.keycode)) {
        handleCtrlUp();
      }
    });

    uIOhook.start();
    mode = 'uiohook';
    console.log('[KeyListener] uiohook-napi 已启动（监听双击 Ctrl）');
    return true;
  } catch (err) {
    console.warn('[KeyListener] uiohook-napi 加载失败，将使用降级方案：', (err as Error).message);
    return false;
  }
}

function startFallback(): void {
  // 降级方案：注册 Ctrl+Shift+K，按下即触发
  const accelerator = 'CommandOrControl+Shift+K';
  const ok = globalShortcut.register(accelerator, () => {
    console.log('[KeyListener][fallback] 快捷键触发');
    maybeTrigger();
  });
  if (ok) {
    mode = 'fallback';
    console.log(`[KeyListener] 降级方案已启用，请按 ${accelerator} 触发解读`);
  } else {
    mode = 'none';
    console.error(`[KeyListener] 降级快捷键注册失败：${accelerator}`);
  }
}

export interface KeyListenerOptions {
  onTrigger: () => void;
}

export function startKeyListener(options: KeyListenerOptions): Mode {
  if (started) return mode;
  started = true;
  onTrigger = options.onTrigger;

  const ok = tryStartUiohook();
  if (!ok) startFallback();
  return mode;
}

export function stopKeyListener(): void {
  if (!started) return;
  if (mode === 'uiohook') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { uIOhook } = require('uiohook-napi');
      uIOhook.stop();
    } catch {
      /* ignore */
    }
  } else if (mode === 'fallback') {
    globalShortcut.unregisterAll();
  }
  started = false;
  mode = 'none';
}

export function getMode(): Mode {
  return mode;
}
