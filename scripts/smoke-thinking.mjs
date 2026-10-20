// 对比 v4-flash 的思考开 / 关 模式速度
import fs from 'node:fs';
import path from 'node:path';
const cfg = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'TangShiYe', 'config.json'), 'utf8'));
const url = cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions';

const prompt = `用 2-3 句中文（不超 80 字）解释这段代码做了什么：
\`\`\`
def is_prime(n):
    if n < 2: return False
    for i in range(2, int(n ** 0.5) + 1):
        if n % i == 0: return False
    return True
\`\`\``;

async function test(label, body) {
  console.log('\n=== ' + label + ' ===');
  const t0 = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) { console.log('  ❌', res.status, (await res.text()).slice(0, 300)); return; }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '', content = '', reasoning = '', firstContentAt = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const p = line.slice(5).trim();
      if (p === '[DONE]') continue;
      try {
        const d = JSON.parse(p)?.choices?.[0]?.delta;
        if (d?.reasoning_content) reasoning += d.reasoning_content;
        if (d?.content) { if (!firstContentAt) firstContentAt = Date.now(); content += d.content; }
      } catch {}
    }
  }
  console.log('  首字:        ', firstContentAt - t0, 'ms');
  console.log('  完成:        ', Date.now() - t0, 'ms');
  console.log('  reasoning:   ', reasoning.length, '字符');
  console.log('  content:     ', content.length, '字符');
  console.log('  内容:', content);
}

const base = {
  model: 'deepseek-v4-flash',
  messages: [{ role: 'user', content: prompt }],
  max_tokens: 1024,
  stream: true,
};

await test('思考开启（默认）', { ...base, thinking: { type: 'enabled' } });
await test('思考关闭', { ...base, thinking: { type: 'disabled' } });
