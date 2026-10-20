import { Tray, Menu, nativeImage, app, shell } from 'electron';
import * as path from 'path';
import type { DetailMode } from './store';

interface TrayOptions {
  isEnabled: () => boolean;
  getDetailMode: () => DetailMode;
  isOffline: () => boolean;
  onToggleEnabled: (value: boolean) => void;
  onToggleDetailMode: (mode: DetailMode) => void;
  onToggleOffline: (value: boolean) => void;
  onTriggerExplain: () => void;
  /** 打开图形化设置窗口（填 API Key / 选服务商 / 测试连接） */
  onOpenSettings: () => void;
  onQuit: () => void;
}

let tray: Tray | null = null;
let opts: TrayOptions | null = null;

function getIconPath(enabled: boolean): string {
  const iconName = enabled ? 'tray-icon.png' : 'tray-icon-disabled.png';
  return path.join(app.getAppPath(), 'assets', iconName);
}

function buildMenu(): Menu {
  const enabled = opts ? opts.isEnabled() : true;
  const detailMode: DetailMode = opts ? opts.getDetailMode() : 'lineByLine';
  const offline = opts ? opts.isOffline() : false;
  return Menu.buildFromTemplate([
    {
      label: enabled ? '✅ 已启用（点击暂停）' : '⏸️ 已暂停（点击启用）',
      click: () => {
        if (!opts) return;
        opts.onToggleEnabled(!enabled);
        refresh();
      },
    },
    { type: 'separator' },
    {
      label: '⚙️ 设置…（填 API Key / 选模型）',
      click: () => {
        if (opts) opts.onOpenSettings();
      },
    },
    { type: 'separator' },
    {
      label: offline
        ? '🔌 离线模式：开（不联网，规则引擎解释）'
        : '🌐 在线模式：开（调用 LLM）',
      click: () => {
        if (!opts) return;
        opts.onToggleOffline(!offline);
        refresh();
      },
    },
    {
      label: offline
        ? '     点此切换回在线模式（需 API Key / 本地模型）'
        : '     点此切换离线模式（断网也能逐行解释）',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: '🔍 测试弹窗',
      click: () => {
        if (opts) opts.onTriggerExplain();
      },
    },
    { type: 'separator' },
    {
      label: '详解模式',
      enabled: false,
    },
    {
      label: detailMode === 'lineByLine' ? '✅ 逐行注释（行号+代码+解释）' : '   逐行注释（行号+代码+解释）',
      type: 'radio',
      checked: detailMode === 'lineByLine',
      click: () => {
        if (!opts) return;
        opts.onToggleDetailMode('lineByLine');
        refresh();
      },
    },
    {
      label: detailMode === 'segmented' ? '✅ 拆解（示例+参数+注意）' : '   拆解（示例+参数+注意）',
      type: 'radio',
      checked: detailMode === 'segmented',
      click: () => {
        if (!opts) return;
        opts.onToggleDetailMode('segmented');
        refresh();
      },
    },
    { type: 'separator' },
    {
      label: '📖 使用说明',
      click: () => {
        shell.openExternal('https://github.com/zuoshuzhang/TangShiYe#readme');
      },
    },
    { type: 'separator' },
    {
      label: '🚪 退出',
      click: () => {
        if (opts) opts.onQuit();
      },
    },
  ]);
}

function refresh(): void {
  if (!tray || !opts) return;
  const enabled = opts.isEnabled();
  const image = nativeImage.createFromPath(getIconPath(enabled));
  if (process.platform === 'darwin') image.setTemplateImage(true);
  tray.setImage(image);
  const offline = opts.isOffline();
  tray.setToolTip(
    enabled ? (offline ? '汤师爷 · 离线模式（规则引擎）' : '汤师爷 · 已启用（在线）') : '汤师爷 · 已暂停'
  );
  tray.setContextMenu(buildMenu());
}

/** 供设置窗口保存后刷新托盘菜单状态（离线开关 / 详解模式可能被改过） */
export function refreshTray(): void {
  refresh();
}

export function initTray(options: TrayOptions): void {
  opts = options;
  const image = nativeImage.createFromPath(getIconPath(options.isEnabled()));
  if (process.platform === 'darwin') image.setTemplateImage(true);
  tray = new Tray(image);
  tray.setToolTip('汤师爷 · 已启用');
  tray.setContextMenu(buildMenu());

  // 左键单击托盘：触发演示弹窗
  tray.on('click', () => {
    if (opts) opts.onTriggerExplain();
  });
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}
