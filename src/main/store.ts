/**
 * 配置持久化（electron-store）。
 *
 * 文件位置：app.getPath('userData')/config.json
 * 目录名跟随 package.json 的 productName（"TangShiYe"），不是包名 name。
 * - Windows: %APPDATA%/TangShiYe/config.json
 * - macOS:   ~/Library/Application Support/TangShiYe/config.json
 * - Linux:   ~/.config/TangShiYe/config.json
 *
 * 优先用托盘「⚙️ 设置…」的图形界面修改；只有批量部署/版本管理时才手改 JSON。
 * 环境变量 ZHIPU_API_KEY / OLLAMA_API_KEY / OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL 可覆盖。
 */

// electron-store 在 v9 起为 ESM-only；我们锁定 v8 以保持 CJS 兼容
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ElectronStore = require('electron-store') as new <T>(opts?: { defaults?: T; name?: string }) => {
  get<K extends keyof T>(key: K): T[K];
  set<K extends keyof T>(key: K, value: T[K]): void;
  set(values: Partial<T>): void;
  store: T;
  path: string;
};

export type Provider = 'openai-compat' | 'zhipu' | 'ollama' | 'claude';

/**
 * 思考模式（DeepSeek 等推理模型）：
 * - 'disabled' ：关闭思考，最快、最便宜（推荐用于速览/详解这种简单任务）
 * - 'enabled'  ：开启思考（模型默认），慢 2~3 倍但答案更稳
 * - 'auto'     ：不传 thinking 参数，由服务端默认决定（兼容非 DeepSeek 的 OpenAI 兼容接口）
 */
export type ThinkingMode = 'auto' | 'disabled' | 'enabled';

/**
 * 详情模式：详解时输出的样式
 * - 'segmented'  原版：最小示例 + 参数表 + 注意（自然语言分段拆解）
 * - 'lineByLine' 新增：三行一组(行号/代码/解释)流式输出，浮窗 CSS Grid 三列对齐渲染
 */
export type DetailMode = 'segmented' | 'lineByLine';

export interface Config {
  provider: Provider;
  apiKey: string;
  baseUrl: string;
  model: string;
  thinking: ThinkingMode;
  doubleTapThreshold: number; // ms
  autoCopy: boolean;          // 是否自动模拟 Ctrl+C（P1）
  explainLanguage: string;    // 解释输出语言
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  autoLaunch: boolean;
  detailMode: DetailMode;     // 详解输出模式
  /**
   * 离线模式：开启后完全不联网、不调用 LLM，改由 src/main/offline/engine.ts
   * 的静态规则引擎（词典 + 正则）逐行解释。断网或没有 API Key 时的兜底。
   * 可由托盘菜单「🔌 离线模式」实时切换。
   */
  offlineMode: boolean;
}

/**
 * 各 provider 的出厂默认 baseUrl / model / thinking。
 * 用户在 config.json 里可覆盖这些值。
 */
export const PROVIDER_PRESETS: Record<Provider, {
  baseUrl: string;
  model: string;
  thinking: ThinkingMode;
  keyHint?: string;
}> = {
  'openai-compat': {
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
    thinking: 'disabled',
  },
  zhipu: {
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4/',
    model: 'glm-4-flash',
    thinking: 'auto',
    keyHint: '智谱 AI 开放平台 https://open.bigmodel.cn/ 注册实名后免费领取 2000 万 token',
  },
  ollama: {
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen2.5-coder:7b',
    thinking: 'auto',
    keyHint: '本地 Ollama：先 ollama serve，再 ollama pull qwen2.5-coder:7b；apiKey 字段填任意非空串（如 "ollama"）',
  },
  claude: {
    baseUrl: '',
    model: '',
    thinking: 'auto',
  },
};

const DEFAULTS: Config = {
  provider: 'zhipu',         // 默认走智谱 GLM-4-Flash 永久免费
  apiKey: '',
  baseUrl: PROVIDER_PRESETS.zhipu.baseUrl,
  model: PROVIDER_PRESETS.zhipu.model,
  thinking: PROVIDER_PRESETS.zhipu.thinking,
  doubleTapThreshold: 300,
  autoCopy: false,
  explainLanguage: '简体中文',
  difficulty: 'beginner',
  autoLaunch: false,
  detailMode: 'lineByLine',  // fork 默认走逐行注释
  offlineMode: false,        // 默认联网；断网时在托盘里打开即可
};

let storeInstance: ReturnType<typeof createStore> | null = null;

function createStore() {
  return new ElectronStore<Config>({
    name: 'config',
    defaults: DEFAULTS,
  });
}

function getStore() {
  if (!storeInstance) storeInstance = createStore();
  return storeInstance;
}

function envOverrides(): Partial<Config> {
  const out: Partial<Config> = {};
  if (process.env.DEEPSEEK_API_KEY) out.apiKey = process.env.DEEPSEEK_API_KEY;
  if (process.env.ZHIPU_API_KEY) out.apiKey = process.env.ZHIPU_API_KEY;
  if (process.env.OLLAMA_API_KEY) out.apiKey = process.env.OLLAMA_API_KEY;
  if (process.env.OPENAI_API_KEY) out.apiKey = process.env.OPENAI_API_KEY;
  if (process.env.CODEWHISPER_API_KEY) out.apiKey = process.env.CODEWHISPER_API_KEY;
  if (process.env.OPENAI_BASE_URL) out.baseUrl = process.env.OPENAI_BASE_URL;
  if (process.env.CODEWHISPER_BASE_URL) out.baseUrl = process.env.CODEWHISPER_BASE_URL;
  if (process.env.OPENAI_MODEL) out.model = process.env.OPENAI_MODEL;
  if (process.env.CODEWHISPER_MODEL) out.model = process.env.CODEWHISPER_MODEL;
  return out;
}

export function getConfig(): Config {
  const stored = getStore().store;
  return { ...stored, ...envOverrides() };
}

export function setConfig(patch: Partial<Config>): void {
  getStore().set(patch);
}

export function getConfigPath(): string {
  return getStore().path;
}
