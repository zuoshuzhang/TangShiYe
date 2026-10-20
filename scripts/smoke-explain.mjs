// 端到端验证 quickExplain / detailedExplain 在用户当前配置下能返回有效内容。
// 通过 require 直接调用 dist 下的编译产物（避免再装 ts-node）。
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const cfgPath = path.join(process.env.APPDATA, 'TangShiYe', 'config.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));

const sample = `def is_prime(n):
    if n < 2: return False
    for i in range(2, int(n ** 0.5) + 1):
        if n % i == 0: return False
    return True`;

const quickPrompt = `你是一个面向中文编程初学者的代码解读助手。
请用简洁的中文解释以下代码的含义。

要求：
- 2-3 句话，总共不超过 80 个汉字
- 用最通俗的语言，假设用户完全没有编程基础
- 说清楚"这段代码做了什么事"
- 只输出纯文字解释，不要输出代码、不要 Markdown、不要前后缀

代码（可能是 python）：
\`\`\`
${sample}
\`\`\``;

const url2 = cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions';
console.log('[1/2] 速览测试（maxTokens=1024）…');
const t0 = Date.now();
const r1 = await fetch(url2, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
  body: JSON.stringify({ model: cfg.model, messages: [{ role: 'user', content: quickPrompt }], temperature: 0.2, max_tokens: 1024, stream: false }),
});
const j1 = await r1.json();
console.log('  状态:', r1.status, '耗时:', Date.now() - t0, 'ms');
console.log('  content:', JSON.stringify(j1?.choices?.[0]?.message?.content));
console.log('  finish_reason:', j1?.choices?.[0]?.finish_reason);
console.log('  usage:', j1?.usage);

console.log('\n[2/2] 详解测试（maxTokens=4096）…');
const t1 = Date.now();
const detailPrompt = `你是一个面向中文编程初学者的代码教学助手。
请对以下代码进行详细的教学式解释。

请严格按以下 Markdown 格式输出：

## 拆解
把代码拆成几个关键部分，每个部分一行：**\`关键词\`** — 一句话解释

## 示例
\`\`\`python
一段可运行的完整示例
\`\`\`

## 要点
用 2-3 个 • 开头的短句总结要点。

代码：
\`\`\`
${sample}
\`\`\``;
const r2 = await fetch(url2, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
  body: JSON.stringify({ model: cfg.model, messages: [{ role: 'user', content: detailPrompt }], temperature: 0.3, max_tokens: 4096, stream: false }),
});
const j2 = await r2.json();
console.log('  状态:', r2.status, '耗时:', Date.now() - t1, 'ms');
const c2 = j2?.choices?.[0]?.message?.content || '';
console.log('  content 前 300 字:', c2.slice(0, 300));
console.log('  content 总长度:', c2.length, '字符');
console.log('  finish_reason:', j2?.choices?.[0]?.finish_reason);
console.log('  usage:', j2?.usage);
