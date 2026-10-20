// 用新版 prompt 跑几个真实案例，检验输出"具体而不抽象"
import fs from 'node:fs';
import path from 'node:path';
const cfg = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'TangShiYe', 'config.json'), 'utf8'));
const url = cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions';

// 把 main 编译产物里的 prompt 复用一下
const { quickExplainPrompt, detailedExplainPrompt } = await import('../dist/main/prompts.js');

const CASES = [
  { lang: 'python', code: 'c = collections.Counter(nums)' },
  { lang: 'python', code: 'st = set(nums)' },
  { lang: 'python', code: `def two_sum(nums, target):
    seen = {}
    for i, n in enumerate(nums):
        if target - n in seen: return [seen[target - n], i]
        seen[n] = i` },
  { lang: 'javascript', code: 'const ids = arr.map(x => x.id).filter(Boolean);' },
];

async function call(content, max_tokens) {
  const t0 = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      messages: [{ role: 'user', content }],
      temperature: 0.2,
      max_tokens,
      thinking: { type: 'disabled' },
      stream: false,
    }),
  });
  const j = await res.json();
  const elapsed = Date.now() - t0;
  return { content: j?.choices?.[0]?.message?.content || '', elapsed };
}

for (const c of CASES) {
  console.log('━'.repeat(72));
  console.log('代码:', c.code.replace(/\n/g, ' ⏎ ').slice(0, 80));
  console.log('');
  console.log('【速览】');
  const q = await call(quickExplainPrompt({ code: c.code, language: c.lang }), 600);
  console.log(q.content);
  console.log('  (耗时 ' + q.elapsed + 'ms, ' + q.content.length + ' 字符)');
  console.log('');
  console.log('【详解】');
  const d = await call(detailedExplainPrompt({ code: c.code, language: c.lang }), 3000);
  console.log(d.content);
  console.log('  (耗时 ' + d.elapsed + 'ms, ' + d.content.length + ' 字符)');
}
