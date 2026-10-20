// 独立测试 LLM 配置是否连通。
// 用法: node scripts/smoke-llm.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const cfgPath = path.join(os.homedir(), 'AppData', 'Roaming', 'TangShiYe', 'config.json');
console.log('读取配置:', cfgPath);
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
console.log('baseUrl:', cfg.baseUrl);
console.log('model  :', cfg.model);
console.log('apiKey :', cfg.apiKey ? cfg.apiKey.slice(0, 8) + '...' : '(空)');

const url = cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions';
console.log('请求 URL:', url);

const t0 = Date.now();
const res = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${cfg.apiKey}`,
  },
  body: JSON.stringify({
    model: cfg.model,
    messages: [
      { role: 'user', content: '用一句中文回答：1+1 等于几？' },
    ],
    temperature: 0.1,
    max_tokens: 32,
    stream: false,
  }),
});
console.log('耗时:', Date.now() - t0, 'ms');
console.log('状态:', res.status);

const text = await res.text();
console.log('响应:', text.slice(0, 500));
