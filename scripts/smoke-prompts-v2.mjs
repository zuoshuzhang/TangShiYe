// 验证新版速览 prompt：是什么 + 作用 + 完整签名（含默认值）
import fs from 'node:fs';
import path from 'node:path';
const cfg = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'TangShiYe', 'config.json'), 'utf8'));
const url = cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions';
const { quickExplainPrompt } = await import('../dist/main/prompts.js');

const CASES = [
  { lang: 'python', code: 'c = collections.Counter(nums)' },
  { lang: 'python', code: 'arr = [0] * L' },
  { lang: 'python', code: 'arr.sort(key=lambda x: x.id, reverse=True)' },
  { lang: 'python', code: 'st = set(nums)' },
  { lang: 'python', code: 'pairs = list(zip(keys, values))' },
  { lang: 'python', code: "lines = open('a.txt', encoding='utf-8').read().splitlines()" },
  { lang: 'javascript', code: 'const ids = arr.map(x => x.id).filter(Boolean);' },
  { lang: 'javascript', code: 'const m = new Map(entries);' },
  { lang: 'python', code: `def two_sum(nums, target):
    seen = {}
    for i, n in enumerate(nums):
        if target - n in seen: return [seen[target - n], i]
        seen[n] = i` },
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
  return { content: j?.choices?.[0]?.message?.content || '', elapsed: Date.now() - t0 };
}

for (const c of CASES) {
  console.log('━'.repeat(72));
  console.log('代码:', c.code.replace(/\n/g, ' ⏎ ').slice(0, 80));
  console.log('');
  const q = await call(quickExplainPrompt({ code: c.code, language: c.lang }), 800);
  console.log(q.content);
  console.log(`  (${q.elapsed}ms, ${q.content.length}字)`);
}
