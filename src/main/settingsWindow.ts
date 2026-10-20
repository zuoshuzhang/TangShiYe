/**
 * 设置窗口：图形化填 API Key / 选 provider / 测试连接。
 *
 * 之前只能让用户自己去 %APPDATA%\TangShiYe\config.json 手改 JSON，
 * 对非开发者太不友好。这个窗口解决三件事：
 *   1. 填 Key（密码框 + 显隐切换）
 *   2. 选服务商（智谱免费 / Ollama 本地 / 其他 OpenAI 兼容）
 *   3. 测试连接 —— 当场验证 Key 是否有效，不用先复制一段代码去试
 *
 * 只暴露必要的 IPC，全部走 contextIsolation + 独立 preload。
 */
import { BrowserWindow, ipcMain, shell, app } from 'electron';
import * as path from 'path';
import { getConfig, setConfig, getConfigPath, PROVIDER_PRESETS, Config, Provider } from './store';
import { OpenAIProvider } from './llm/openaiProvider';
import { refreshTray } from './tray';

let win: BrowserWindow | null = null;

/** 设置窗口用系统标题栏（800x760），不做无边框自绘 —— 简单可靠优先 */
const WIDTH = 800;
const HEIGHT = 780;

export function openSettingsWindow(): void {
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
    return;
  }

  win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    minWidth: 680,
    minHeight: 600,
    title: '汤师爷 · 设置',
    backgroundColor: '#ffffff',
    show: false,
    resizable: true,
    minimizable: true,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(app.getAppPath(), 'dist', 'preload', 'settings-preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  win.loadFile(path.join(app.getAppPath(), 'src', 'renderer', 'settings', 'index.html'));

  win.once('ready-to-show', () => {
    win?.show();
    win?.focus();
  });

  win.on('closed', () => {
    win = null;
  });
}

export function closeSettingsWindow(): void {
  if (win && !win.isDestroyed()) win.close();
}

export function isSettingsWindowOpen(): boolean {
  return !!win && !win.isDestroyed();
}

/**
 * 测试连接：用**用户在界面上填的值**（不一定已保存）发一次极短请求。
 * 成功返回模型回显，失败返回人话错误。
 */
async function testConnection(payload: {
  provider: Provider;
  apiKey: string;
  baseUrl: string;
  model: string;
}): Promise<{ ok: boolean; message: string; latencyMs?: number }> {
  const { provider, baseUrl, model } = payload;
  const apiKey = provider === 'ollama' ? (payload.apiKey || 'ollama') : payload.apiKey;

  if (!baseUrl.trim()) return { ok: false, message: 'Base URL 不能为空' };
  if (!model.trim()) return { ok: false, message: '模型名不能为空' };
  if (provider !== 'ollama' && !apiKey.trim()) {
    return { ok: false, message: '还没填 API Key' };
  }

  const t0 = Date.now();
  try {
    const p = new OpenAIProvider({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), model: model.trim(), thinking: 'auto' });
    const reply = await p.complete(
      [{ role: 'user', content: '只回复两个字：收到' }],
      { maxTokens: 32, temperature: 0 },
    );
    const ms = Date.now() - t0;
    return {
      ok: true,
      message: `连接成功（${ms} ms）· 模型回复：${(reply || '').trim().slice(0, 40) || '(空)'}`,
      latencyMs: ms,
    };
  } catch (err) {
    const ms = Date.now() - t0;
    const raw = err instanceof Error ? err.message : String(err);
    let hint = raw;
    if (/401|Unauthorized|invalid.*key|api key/i.test(raw)) hint = 'API Key 无效或已过期，请核对后重试';
    else if (/404/.test(raw)) hint = `接口 404：Base URL 可能不对（当前 ${baseUrl}），或模型名 ${model} 不存在`;
    else if (/403/.test(raw)) hint = '无权限（403）：账号未实名 / 未开通该模型 / 余额不足';
    else if (/429/.test(raw)) hint = '请求太频繁或超出配额（429），稍后再试';
    else if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|fetch failed|网络/i.test(raw)) {
      hint = provider === 'ollama'
        ? `连不上本地 Ollama（${baseUrl}）。先确认已运行 "ollama serve"，并且已 "ollama pull ${model}"`
        : '网络不通：检查网络连接 / 代理设置 / Base URL 是否可访问';
    }
    return { ok: false, message: `${hint}${raw && !raw.includes(hint) ? `\n原始错误：${raw.slice(0, 200)}` : ''}（${ms} ms）` };
  }
}

/** 注册设置窗口相关 IPC（只注册一次） */
export function initSettingsIpc(): void {
  ipcMain.handle('settings:get', () => {
    const cfg = getConfig();
    return {
      config: {
        provider: cfg.provider,
        apiKey: cfg.apiKey,
        baseUrl: cfg.baseUrl,
        model: cfg.model,
        detailMode: cfg.detailMode,
        offlineMode: cfg.offlineMode,
        autoLaunch: cfg.autoLaunch,
      },
      presets: PROVIDER_PRESETS,
      configPath: getConfigPath(),
      appVersion: app.getVersion(),
    };
  });

  ipcMain.handle('settings:save', (_e, patch: Partial<Config>) => {
    // 白名单：只接受这几个字段，避免 renderer 传入奇怪的东西
    const allowed: (keyof Config)[] = [
      'provider', 'apiKey', 'baseUrl', 'model', 'detailMode', 'offlineMode', 'autoLaunch',
    ];
    const clean: Partial<Config> = {};
    for (const k of allowed) {
      if (patch && Object.prototype.hasOwnProperty.call(patch, k)) {
        (clean as Record<string, unknown>)[k as string] = patch[k];
      }
    }
    setConfig(clean);

    // autoLaunch 需要同步到系统登录项
    if (clean.autoLaunch !== undefined) {
      try {
        app.setLoginItemSettings({ openAtLogin: !!clean.autoLaunch });
      } catch (e) {
        console.warn('[Settings] 设置开机自启失败:', e);
      }
    }

    // 托盘菜单里的「离线模式 / 详解模式」勾选状态要跟着变
    try {
      refreshTray();
    } catch (e) {
      console.warn('[Settings] 刷新托盘失败:', e);
    }

    console.log('[Settings] 已保存:', JSON.stringify({
      ...clean,
      apiKey: clean.apiKey ? `已设置(${String(clean.apiKey).length}字符)` : '空',
    }));
    return { ok: true };
  });

  ipcMain.handle('settings:test', async (_e, payload) => {
    return testConnection(payload);
  });

  ipcMain.handle('settings:close', () => {
    closeSettingsWindow();
    return { ok: true };
  });

  ipcMain.handle('settings:open-config-dir', () => {
    shell.showItemInFolder(getConfigPath());
    return { ok: true };
  });

  ipcMain.handle('settings:open-url', (_e, url: string) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { ok: true };
  });
}
