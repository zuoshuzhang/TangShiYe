/**
 * 设置页逻辑。
 *
 * 三条用户体验原则：
 *  1. 换服务商时，如果用户没手动改过 URL/模型，就自动跟着换预设（不然容易填串）
 *  2. 测试连接必须能当场给出人话结论，不能只说"失败"
 *  3. 保存前不做硬性拦截 —— 没填 Key 也能存（用户可能就想用离线模式）
 */

/**
 * 预览用 mock：直接用浏览器打开这个 HTML 时没有 preload 注入，
 * 用假数据渲染一遍，方便不装软件就查看界面。
 * 在 Electron 里 window.tsySettings 一定存在，不会走到这里。
 */
function createMockBridge() {
  return {
    load: async () => ({
      config: {
        provider: 'zhipu',
        apiKey: '',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4/',
        model: 'glm-4-flash',
        detailMode: 'lineByLine',
        offlineMode: false,
        autoLaunch: false,
      },
      presets: {
        zhipu: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4/', model: 'glm-4-flash', thinking: 'auto' },
        ollama: { baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5-coder:7b', thinking: 'auto' },
        'openai-compat': { baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', thinking: 'disabled' },
      },
      configPath: '%APPDATA%\\TangShiYe\\config.json',
      appVersion: '0.2.1-preview',
    }),
    save: async () => ({ ok: true }),
    test: async () => ({ ok: true, message: '（预览模式）连接成功 · 模型回复：收到', latencyMs: 312 }),
    close: async () => ({ ok: true }),
    openConfigDir: async () => ({ ok: true }),
    openUrl: async (url) => { window.open(url, '_blank'); return { ok: true }; },
  };
}

const bridge = window.tsySettings || createMockBridge();

const PROVIDER_HINTS = {
  zhipu:
    '去 <a href="#" class="ext" data-url="https://open.bigmodel.cn/">open.bigmodel.cn</a> 注册并实名，' +
    '在「API Keys」页创建 Key，粘贴到上面。<b>GLM-4-Flash 长期免费</b>，注册还送 2000 万 token。',
  ollama:
    '本地跑，无需 Key。先装 <a href="#" class="ext" data-url="https://ollama.com/download">Ollama</a>，' +
    '命令行执行 <code>ollama pull qwen2.5-coder:7b</code>，再 <code>ollama serve</code>。' +
    'API Key 随便填（例如 <code>ollama</code>）。',
  'openai-compat':
    '支持任何 OpenAI 兼容接口。DeepSeek 填 <code>https://api.deepseek.com</code> + <code>deepseek-chat</code>；' +
    '通义填 <code>https://dashscope.aliyuncs.com/compatible-mode/v1</code> + <code>qwen-plus</code>；' +
    'Kimi 填 <code>https://api.moonshot.cn/v1</code> + <code>moonshot-v1-8k</code>。',
};

const els = {
  providerGrid: document.getElementById('provider-grid'),
  providerHint: document.getElementById('provider-hint'),
  apiKey: document.getElementById('api-key'),
  keyHint: document.getElementById('key-hint'),
  toggleKey: document.getElementById('toggle-key'),
  baseUrl: document.getElementById('base-url'),
  model: document.getElementById('model'),
  btnTest: document.getElementById('btn-test'),
  testStatus: document.getElementById('test-status'),
  detailMode: document.getElementById('detail-mode'),
  offlineMode: document.getElementById('offline-mode'),
  autoLaunch: document.getElementById('auto-launch'),
  btnOpenDir: document.getElementById('btn-open-dir'),
  btnCancel: document.getElementById('btn-cancel'),
  btnSave: document.getElementById('btn-save'),
  version: document.getElementById('version'),
  toast: document.getElementById('toast'),
};

let state = {
  provider: 'zhipu',
  detailMode: 'lineByLine',
  presets: {},
  /** 上次切换 provider 时自动填进输入框的值，用来判断用户有没有手动改过 */
  autoFilled: { baseUrl: '', model: '' },
};

/* ───────────── 工具 ───────────── */

let toastTimer = null;
function toast(msg, isErr = false) {
  els.toast.textContent = msg;
  els.toast.classList.toggle('err', !!isErr);
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2200);
}

function setTestStatus(text, kind) {
  els.testStatus.textContent = text || '';
  els.testStatus.className = 'test-status' + (kind ? ' ' + kind : '');
}

/* ───────────── 渲染 ───────────── */

function renderProvider() {
  for (const btn of els.providerGrid.querySelectorAll('.provider')) {
    btn.classList.toggle('active', btn.dataset.provider === state.provider);
  }
  const hint = PROVIDER_HINTS[state.provider] || '';
  els.providerHint.innerHTML = hint;

  // API Key 字段在 Ollama 下不重要，改一下提示
  els.keyHint.textContent =
    state.provider === 'ollama'
      ? '本地模型不校验 Key，随便填一个非空值即可'
      : '';
}

function renderDetailMode() {
  for (const btn of els.detailMode.querySelectorAll('button')) {
    btn.classList.toggle('active', btn.dataset.mode === state.detailMode);
  }
}

/**
 * 切服务商：只在用户"没手动改过"时才覆盖 URL/模型。
 * 判断依据是输入框的当前值仍等于上一次自动填入的值。
 */
function applyProviderPreset(provider) {
  const preset = state.presets[provider];
  if (!preset) return;

  const urlUntouched = !els.baseUrl.value.trim() || els.baseUrl.value === state.autoFilled.baseUrl;
  const modelUntouched = !els.model.value.trim() || els.model.value === state.autoFilled.model;

  if (urlUntouched && preset.baseUrl) els.baseUrl.value = preset.baseUrl;
  if (modelUntouched && preset.model) els.model.value = preset.model;

  state.autoFilled = {
    baseUrl: preset.baseUrl || '',
    model: preset.model || '',
  };
  setTestStatus('', '');
}

/* ───────────── 事件 ───────────── */

els.providerGrid.addEventListener('click', (e) => {
  const btn = e.target.closest('.provider');
  if (!btn) return;
  const next = btn.dataset.provider;
  if (next === state.provider) return;
  state.provider = next;
  renderProvider();
  applyProviderPreset(next);
});

els.toggleKey.addEventListener('click', () => {
  const showing = els.apiKey.type === 'text';
  els.apiKey.type = showing ? 'password' : 'text';
  els.toggleKey.title = showing ? '显示' : '隐藏';
});

els.detailMode.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-mode]');
  if (!btn) return;
  state.detailMode = btn.dataset.mode;
  renderDetailMode();
});

// 外部链接：交给主进程 shell.openExternal，不在窗口内导航
document.addEventListener('click', (e) => {
  const a = e.target.closest('a.ext');
  if (!a) return;
  e.preventDefault();
  const url = a.dataset.url;
  if (url) bridge.openUrl(url);
});

els.btnOpenDir.addEventListener('click', () => bridge.openConfigDir());

els.btnCancel.addEventListener('click', () => bridge.close());

els.btnTest.addEventListener('click', async () => {
  els.btnTest.disabled = true;
  setTestStatus('正在连接，请稍候…', 'pending');
  try {
    const r = await bridge.test({
      provider: state.provider,
      apiKey: els.apiKey.value,
      baseUrl: els.baseUrl.value,
      model: els.model.value,
    });
    setTestStatus(r.message, r.ok ? 'ok' : 'err');
  } catch (err) {
    setTestStatus('测试过程出错：' + (err && err.message ? err.message : String(err)), 'err');
  } finally {
    els.btnTest.disabled = false;
  }
});

els.btnSave.addEventListener('click', async () => {
  const provider = state.provider;
  const apiKey = els.apiKey.value.trim();
  const baseUrl = els.baseUrl.value.trim() || state.presets[provider]?.baseUrl || '';
  const model = els.model.value.trim() || state.presets[provider]?.model || '';

  if (!baseUrl || !model) {
    toast('Base URL 和模型名不能为空', true);
    return;
  }
  // 不硬拦：用户可能就只想用离线模式。只提醒一句。
  if (provider !== 'ollama' && !apiKey) {
    toast(els.offlineMode.checked ? '已保存：未填 Key，走离线模式' : '注意：没填 API Key，联网模式会报错');
  }

  els.btnSave.disabled = true;
  try {
    await bridge.save({
      provider,
      apiKey,
      baseUrl,
      model,
      detailMode: state.detailMode,
      offlineMode: els.offlineMode.checked,
      autoLaunch: els.autoLaunch.checked,
    });
    toast('已保存，设置立即生效');
    setTimeout(() => bridge.close(), 600);
  } catch (err) {
    toast('保存失败：' + (err && err.message ? err.message : String(err)), true);
    els.btnSave.disabled = false;
  }
});

/* ───────────── 初始化 ───────────── */

(async function init() {
  try {
    const data = await bridge.load();
    const cfg = data.config;
    state.presets = data.presets || {};
    state.provider = cfg.provider || 'zhipu';
    state.detailMode = cfg.detailMode || 'lineByLine';

    els.apiKey.value = cfg.apiKey || '';
    els.baseUrl.value = cfg.baseUrl || '';
    els.model.value = cfg.model || '';
    els.offlineMode.checked = !!cfg.offlineMode;
    els.autoLaunch.checked = !!cfg.autoLaunch;

    // 记住初始值，作为"用户是否手动改过"的基准
    state.autoFilled = {
      baseUrl: state.presets[state.provider]?.baseUrl || '',
      model: state.presets[state.provider]?.model || '',
    };

    renderProvider();
    renderDetailMode();
    els.version.textContent = `汤师爷 v${data.appVersion} · 配置文件：${data.configPath}`;
  } catch (err) {
    toast('读取配置失败：' + (err && err.message ? err.message : String(err)), true);
  }
})();
