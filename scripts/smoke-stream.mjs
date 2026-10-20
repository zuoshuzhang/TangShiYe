// 验证流式调用首字延迟与总耗时
import fs from 'node:fs';
import path from 'node:path';

const cfgPath = path.join(process.env.APPDATA, 'TangShiYe', 'config.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const url = cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions';

const sample = `def is_prime(n):
    if n < 2: return False
    for i in range(2, int(n ** 0.5) + 1):
        if n % i == 0: return False
    return True`;

const prompt = `用 2-3 句中文（不超 80 字）解释这段代码做了什么：
\`\`\`
${sample}
\`\`\``;

console.log(`测试: ${cfg.model}`);
const t0 = Date.now();
const res = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
  body: JSON.stringify({
    model: cfg.model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
    max_tokens: 1024,
    stream: true,
  }),
});
console.log('  HTTP 响应到达:', Date.now() - t0, 'ms, 状态:', res.status);

const reader = res.body.getReader();
const decoder = new TextDecoder();
let buf = '';
let full = '';
let firstByteAt = 0;
let firstContentAt = 0;
let reasoningChars = 0;
let bytesIn = 0;

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  if (!firstByteAt) firstByteAt = Date.now();
  bytesIn += value.length;
  buf += decoder.decode(value, { stream: true });
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (payload === '[DONE]') continue;
    try {
      const obj = JSON.parse(payload);
      const delta = obj?.choices?.[0]?.delta;
      if (delta?.reasoning_content) reasoningChars += delta.reasoning_content.length;
      if (delta?.content) {
        if (!firstContentAt) firstContentAt = Date.now();
        full += delta.content;
      }
    } catch {}
  }
}

console.log('  首字节(网络层):    ', firstByteAt - t0, 'ms');
console.log('  首个可见 content:  ', firstContentAt - t0, 'ms');
console.log('  完成:              ', Date.now() - t0, 'ms');
console.log('  reasoning 字符:    ', reasoningChars);
console.log('  最终 content 字符: ', full.length);
console.log('  网络收到字节:      ', bytesIn);
console.log('  内容:', full);
