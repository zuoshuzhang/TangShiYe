/**
 * 端到端验证设置窗口：
 *   1. 带 --open-settings --remote-debugging-port 启动打包后的应用
 *   2. 通过 CDP 连接到设置窗口
 *   3. 检查 window.tsySettings 是否注入、IPC load() 是否返回真实配置
 *   4. 截图存盘
 *
 * 注意：必须清掉 ELECTRON_RUN_AS_NODE，否则 electron 会以纯 node 模式跑
 * （require('electron') 返回 exe 路径字符串，app 起不来）。
 */
import { spawn, execSync } from 'child_process';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import * as path from 'path';

const ROOT = 'C:\\Users\\Administrator.DESKTOP-2AER2CO\\Projects\\tangshiye';
const EXE = path.join(ROOT, 'release', 'win-unpacked', 'TangShiYe.exe');
const PORT = 9333;
const OUT = path.join(ROOT, 'release', 'settings-e2e.png');
const LOG = path.join(ROOT, 'release', 'settings-e2e.log');

const logLines = [];
const log = (s) => { logLines.push(s); console.log(s); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(EXE)) {
  console.error('找不到 exe:', EXE);
  process.exit(2);
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;
// 沙箱/虚拟机没有可用 GPU，GPU 进程崩了会把 app 一起带走
env.TSY_DISABLE_GPU = '1';

// --remote-allow-origins=*：Chrome 111+ 会拒绝非白名单 Origin 的 CDP 连接
// （Node 内置 WebSocket 没有 Origin 头，不加这个就会被 403）
const child = spawn(EXE, ['--open-settings', `--remote-debugging-port=${PORT}`, '--remote-allow-origins=*'], {
  cwd: path.dirname(EXE),
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stderrBuf = '';
child.stderr.on('data', (d) => { stderrBuf += d.toString(); });

function cleanup() {
  try { process.kill(child.pid); } catch {}
  try { execSync('taskkill /F /IM "TangShiYe.exe" /T', { stdio: 'ignore' }); } catch {}
}

async function getTargets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return res.json();
}

/**
 * CDP 单连接：发一条命令、等它自己的 id 回复。
 *
 * 注意：页面 load 期间发 Runtime.evaluate 会卡在"已被销毁的执行上下文"上
 * （promise 永不 resolve），所以这里超时设短一点，别把整轮测试拖死。
 */
function cdp(ws, id, method, params, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const onMsg = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id !== id) return;
      clearTimeout(timer);
      ws.removeEventListener('message', onMsg);
      if (msg.error) reject(new Error(`${method}: ${msg.error.message}`));
      else resolve(msg.result);
    };
    const timer = setTimeout(() => {
      // 超时必须摘掉监听，否则残留 listener 会一路累积
      ws.removeEventListener('message', onMsg);
      reject(new Error(`CDP ${method} 超时`));
    }, timeoutMs);
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

let target = null;
for (let i = 0; i < 25; i++) {
  await sleep(700);
  try {
    const targets = await getTargets();
    const found = targets.find((t) => /settings|设置/i.test(t.title || '') || /settings/i.test(t.url || ''));
    if (found) { target = found; break; }
    if (i === 4 && targets.length) {
      log('当前 targets: ' + targets.map((t) => `${t.type}:${t.title}`).join(' | '));
    }
  } catch (e) {
    // 端口还没起来，继续等
  }
}

if (!target) {
  log('❌ 没找到设置窗口 target');
  log('stderr: ' + stderrBuf.slice(0, 800));
  cleanup();
  writeFileSync(LOG, logLines.join('\n'));
  process.exit(1);
}

log(`✓ 找到设置窗口: ${target.title || '(无标题)'} (${target.url})`);

// 页面还在 load 时连上去查 DOM 会拿到空结果，evaluate 也可能卡死。
// 先给足加载时间再连 —— 这一步省掉会浪费几十秒在超时重试上。
log('等待页面渲染…');
await sleep(5000);

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true });
  ws.addEventListener('error', () => rej(new Error('CDP WebSocket 连接失败')), { once: true });
});

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass++; log(`  ✓ ${label}${extra ? ' — ' + extra : ''}`); }
  else { fail++; log(`  ✗ ${label}${extra ? ' — ' + extra : ''}`); }
};

// 等页面 DOM 加载完 —— 连上 CDP 时页面往往还在 load，
// 直接查 DOM 会得到 0 个元素（踩过）。
let ready = false;
for (let i = 0; i < 6; i++) {
  try {
    const r = await cdp(ws, 900 + i, 'Runtime.evaluate', {
      expression: `document.readyState + '|' + document.querySelectorAll('.provider').length`,
      returnByValue: true,
    });
    const [state, cards] = String(r.result.value || '').split('|');
    if (state === 'complete' && Number(cards) === 3) { ready = true; break; }
  } catch { /* 上下文还没稳，重试 */ }
  await sleep(1000);
}
check('页面加载完成（3 个服务商卡片就绪）', ready);

// 1) preload 是否注入
const r1 = await cdp(ws, 1, 'Runtime.evaluate', {
  expression: `JSON.stringify({
    hasBridge: !!window.tsySettings,
    methods: window.tsySettings ? Object.keys(window.tsySettings) : [],
    title: document.title,
    providerCards: document.querySelectorAll('.provider').length,
    inputs: ['api-key','base-url','model'].map(id => !!document.getElementById(id))
  })`,
  returnByValue: true,
});
const info = JSON.parse(r1.result.value);
log('\n--- 桥接与 DOM ---');
log('  ' + JSON.stringify(info));
check('preload 注入 window.tsySettings', info.hasBridge);
check('暴露 6 个方法', (info.methods || []).length >= 6, (info.methods || []).join(','));
check('3 个服务商卡片渲染', info.providerCards === 3, String(info.providerCards));
check('关键输入框存在', info.inputs.every(Boolean), JSON.stringify(info.inputs));

// 2) IPC load() 是否返回真实配置
const r2 = await cdp(ws, 2, 'Runtime.evaluate', {
  expression: `window.tsySettings.load().then(d => JSON.stringify({
    provider: d.config.provider,
    hasApiKey: typeof d.config.apiKey === 'string',
    baseUrl: d.config.baseUrl,
    model: d.config.model,
    detailMode: d.config.detailMode,
    configPath: d.configPath,
    appVersion: d.appVersion,
    presetKeys: Object.keys(d.presets || {})
  }))`,
  awaitPromise: true,
  returnByValue: true,
});
const cfg = JSON.parse(r2.result.value);
log('\n--- 主进程返回的配置（IPC 通了） ---');
log('  ' + JSON.stringify(cfg, null, 2).replace(/\n/g, '\n  '));
check('IPC settings:get 返回配置', !!cfg.provider, `provider=${cfg.provider}`);
check('预设表完整', (cfg.presetKeys || []).length >= 3, (cfg.presetKeys || []).join(','));
check('版本号正确', String(cfg.appVersion || '').startsWith('0.2.1'), cfg.appVersion);
check('返回真实配置路径', /TangShiYe/i.test(cfg.configPath || ''), cfg.configPath);

// 3) 截图
const shot = await cdp(ws, 3, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
log(`\n✓ 截图已存: ${OUT}`);

ws.close();
cleanup();
log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
writeFileSync(LOG, logLines.join('\n'));
process.exit(fail === 0 ? 0 : 1);
