/**
 * 设置窗口的 preload：只暴露设置页需要的最小 API。
 * 与浮窗的 preload.ts 分开，避免给设置页开放解读/聊天等无关能力。
 */
import { contextBridge, ipcRenderer } from 'electron';

export interface SettingsConfigShape {
  provider: 'openai-compat' | 'zhipu' | 'ollama' | 'claude';
  apiKey: string;
  baseUrl: string;
  model: string;
  detailMode: 'segmented' | 'lineByLine';
  offlineMode: boolean;
  autoLaunch: boolean;
}

export interface PresetShape {
  baseUrl: string;
  model: string;
  thinking: string;
  keyHint?: string;
}

export interface SettingsBridge {
  load(): Promise<{
    config: SettingsConfigShape;
    presets: Record<string, PresetShape>;
    configPath: string;
    appVersion: string;
  }>;
  save(patch: Partial<SettingsConfigShape>): Promise<{ ok: boolean }>;
  test(payload: {
    provider: SettingsConfigShape['provider'];
    apiKey: string;
    baseUrl: string;
    model: string;
  }): Promise<{ ok: boolean; message: string; latencyMs?: number }>;
  close(): Promise<{ ok: boolean }>;
  openConfigDir(): Promise<{ ok: boolean }>;
  openUrl(url: string): Promise<{ ok: boolean }>;
}

const bridge: SettingsBridge = {
  load: () => ipcRenderer.invoke('settings:get'),
  save: (patch) => ipcRenderer.invoke('settings:save', patch),
  test: (payload) => ipcRenderer.invoke('settings:test', payload),
  close: () => ipcRenderer.invoke('settings:close'),
  openConfigDir: () => ipcRenderer.invoke('settings:open-config-dir'),
  openUrl: (url) => ipcRenderer.invoke('settings:open-url', url),
};

contextBridge.exposeInMainWorld('tsySettings', bridge);
