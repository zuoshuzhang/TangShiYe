// 横向对比 deepseek-v4-flash（推理）vs deepseek-chat（非推理）的流式速度
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

async function test(model) {
  console.log('\n=== ' + model + ' ===');
  const t0 = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 1024,
      stream: true,
    }),
  });
  if (!res.ok) {
    console.log('  失败:', res.status, await res.text().then(t => t.slice(0, 200)));
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '', full = '', reasoning = '';
  let firstContentAt = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const p = line.slice(5).trim();
      if (p === '[DONE]') continue;
      try {
        const o = JSON.parse(p);
        const d = o?.choices?.[0]?.delta;
        if (d?.reasoning_content) reasoning += d.reasoning_content;
        if (d?.content) { if (!firstContentAt) firstContentAt = Date.now(); full += d.content; }
      } catch {}
    }
  }
  console.log('  首个可见 content:', firstContentAt - t0, 'ms');
  console.log('  完成:            ', Date.now() - t0, 'ms');
  console.log('  reasoning 字符  :', reasoning.length);
  console.log('  content 字符    :', full.length);
  console.log('  内容:', full);
}

await test('deepseek-v4-flash');
await test('deepseek-chat');
