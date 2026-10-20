import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

export interface QuickPayload {
  code: string;
  explanation?: string;
  /** 当前是否处于离线模式（影响徽章和"追问"禁用） */
  offline?: boolean;
}

export interface LineByLineLine {
  n: number;
  code: string;
  explain: string;
  /** 离线模式携带：'dict' 词典命中 | 'syntax' 语法结构 | 'comment' 注释 | 'blank' 空行 | 'unknown' 未识别 */
  kind?: 'dict' | 'syntax' | 'comment' | 'blank' | 'unknown';
}

export interface DetailPayload {
  /** segmented 模式：markdown 文本 */
  content?: string;
  /** 详解模式：'segmented' | 'lineByLine' */
  mode?: 'segmented' | 'lineByLine';
  /** lineByLine 模式：结构化行数据（DOM 渲染用） */
  lines?: LineByLineLine[];
  /** lineByLine 模式解析失败时的原始 AI 输出（降级显示） */
  raw?: string;
  /** 当前是否处于离线模式（影响徽章和"追问"禁用） */
  offline?: boolean;
}

export interface ChatChunkPayload {
  text: string;
}

export interface ErrorPayload {
  message: string;
}

export interface ModePayload {
  mode: 'segmented' | 'lineByLine';
}

const api = {
  // Main → Renderer 监听
  onShowQuick(handler: (payload: QuickPayload) => void): () => void {
    const listener = (_e: IpcRendererEvent, payload: QuickPayload) => handler(payload);
    ipcRenderer.on('whisper:show-quick', listener);
    return () => ipcRenderer.removeListener('whisper:show-quick', listener);
  },
  onQuickChunk(handler: (payload: ChatChunkPayload) => void): () => void {
    const listener = (_e: IpcRendererEvent, payload: ChatChunkPayload) => handler(payload);
    ipcRenderer.on('whisper:quick-chunk', listener);
    return () => ipcRenderer.removeListener('whisper:quick-chunk', listener);
  },
  onQuickComplete(handler: () => void): () => void {
    const listener = () => handler();
    ipcRenderer.on('whisper:quick-complete', listener);
    return () => ipcRenderer.removeListener('whisper:quick-complete', listener);
  },
  onShowDetail(handler: (payload: DetailPayload) => void): () => void {
    const listener = (_e: IpcRendererEvent, payload: DetailPayload) => handler(payload);
    ipcRenderer.on('whisper:show-detail', listener);
    return () => ipcRenderer.removeListener('whisper:show-detail', listener);
  },
  onDetailChunk(handler: (payload: ChatChunkPayload) => void): () => void {
    const listener = (_e: IpcRendererEvent, payload: ChatChunkPayload) => handler(payload);
    ipcRenderer.on('whisper:detail-chunk', listener);
    return () => ipcRenderer.removeListener('whisper:detail-chunk', listener);
  },
  /** 详解完成（payload 含 mode，lineByLine 模式用） */
  onDetailComplete(handler: (payload?: ModePayload) => void): () => void {
    const listener = (_e: IpcRendererEvent, payload?: ModePayload) => handler(payload);
    ipcRenderer.on('whisper:detail-complete', listener);
    return () => ipcRenderer.removeListener('whisper:detail-complete', listener);
  },
  /** 模式已切换通知（主进程持久化后回发） */
  onModeChanged(handler: (payload: ModePayload) => void): () => void {
    const listener = (_e: IpcRendererEvent, payload: ModePayload) => handler(payload);
    ipcRenderer.on('whisper:mode-changed', listener);
    return () => ipcRenderer.removeListener('whisper:mode-changed', listener);
  },
  onChatChunk(handler: (payload: ChatChunkPayload) => void): () => void {
    const listener = (_e: IpcRendererEvent, payload: ChatChunkPayload) => handler(payload);
    ipcRenderer.on('whisper:chat-chunk', listener);
    return () => ipcRenderer.removeListener('whisper:chat-chunk', listener);
  },
  onChatComplete(handler: () => void): () => void {
    const listener = () => handler();
    ipcRenderer.on('whisper:chat-complete', listener);
    return () => ipcRenderer.removeListener('whisper:chat-complete', listener);
  },
  onLoading(handler: () => void): () => void {
    const listener = () => handler();
    ipcRenderer.on('whisper:loading', listener);
    return () => ipcRenderer.removeListener('whisper:loading', listener);
  },
  onError(handler: (payload: ErrorPayload) => void): () => void {
    const listener = (_e: IpcRendererEvent, payload: ErrorPayload) => handler(payload);
    ipcRenderer.on('whisper:error', listener);
    return () => ipcRenderer.removeListener('whisper:error', listener);
  },
  onPinState(handler: (payload: { pinned: boolean }) => void): () => void {
    const listener = (_e: IpcRendererEvent, payload: { pinned: boolean }) => handler(payload);
    ipcRenderer.on('whisper:pin-state', listener);
    return () => ipcRenderer.removeListener('whisper:pin-state', listener);
  },
  /** 离线模式状态变化（托盘切换时回发） */
  onOfflineState(handler: (payload: { offline: boolean }) => void): () => void {
    const listener = (_e: IpcRendererEvent, payload: { offline: boolean }) => handler(payload);
    ipcRenderer.on('whisper:offline-state', listener);
    return () => ipcRenderer.removeListener('whisper:offline-state', listener);
  },

  // Renderer → Main 发送
  requestDetail(): void {
    ipcRenderer.send('whisper:request-detail');
  },
  sendChat(text: string): void {
    ipcRenderer.send('whisper:send-chat', { text });
  },
  copy(text: string): void {
    ipcRenderer.send('whisper:copy', { text });
  },
  togglePin(): void {
    ipcRenderer.send('whisper:toggle-pin');
  },
  close(): void {
    ipcRenderer.send('whisper:close');
  },
  /** 切到详解视图时通知主进程 */
  expandForDetail(): void {
    ipcRenderer.send('whisper:expand-for-detail');
  },
  /** 切换详解模式：segmented ⇄ lineByLine（主进程持久化并重发详解请求） */
  switchMode(mode: 'segmented' | 'lineByLine'): void {
    ipcRenderer.send('whisper:switch-mode', { mode });
  },
  /** 内容自然高度变化后通知主进程进行 auto-fit */
  autosize(height: number): void {
    ipcRenderer.send('whisper:autosize', { height });
  },
};

contextBridge.exposeInMainWorld('whisper', api);

export type WhisperApi = typeof api;
