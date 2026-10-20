// scripts/gen-offline-preview.mjs
// 用真实离线引擎跑示例代码，把结果内联成静态预览页 preview/offline-preview.html。
// 目的：不用启动 Electron、不用 API Key，就能看到离线逐行解释的实际效果。
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

const enginePath = resolve(process.cwd(), 'dist/main/offline/engine.js');
if (!existsSync(enginePath)) {
  console.error('找不到 ' + enginePath + '，请先 npm run build');
  process.exit(2);
}
const { explainOffline } = await import(pathToFileURL(enginePath).href);

const SAMPLES = [
  {
    lang: 'c',
    title: 'C · 字符串与内存',
    code: `#include <stdio.h>
#include <string.h>

// 统计字符串长度
int main(void) {
    char buf[100];
    char *p = malloc(100);
    strcpy(p, "hello");
    int n = strlen(p);
    for (int i = 0; i < n; i++) {
        if (i % 2 == 0) {
            printf("%c\\n", p[i]);
        }
    }
    free(p);
    return 0;
}`,
  },
  {
    lang: 'python',
    title: 'Python · 词频统计',
    code: `# 统计每个词出现的次数
def word_count(words):
    """返回 {词: 次数}"""
    d = {}
    for w in words:
        d[w] = d.get(w, 0) + 1
    top = sorted(d.items(), key=lambda x: x[1], reverse=True)
    return [k for k, _ in top]`,
  },
];

const payload = SAMPLES.map((s) => ({
  title: s.title,
  lang: s.lang,
  result: explainOffline(s.code, s.lang),
}));

const KIND_LABEL = {
  dict: '📖 词典命中',
  syntax: '🔧 语法结构',
  comment: '💬 注释',
  blank: '· 空行',
  unknown: '❓ 未识别',
};

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>离线模式预览 · TangShiYe</title>
<style>
  :root {
    --bg: #ffffff; --bg-elev: #f6f7f9; --bg-hover: #eef0f3;
    --text: #1c1e21; --text-muted: #5f6672; --text-faint: #98a0ad;
    --border: #e3e6ea; --border-strong: #cbd1d9;
    --accent: #2563eb; --warn: #d97706;
    --num-bg: #fdf6d8; --num-fg: #a16207;
    --code-bg: #f1f3f5; --code-fg: #24292e;
    --exp-fg: #1f7a3d;
  }
  body.dark {
    --bg: #16181d; --bg-elev: #1e2128; --bg-hover: #262a33;
    --text: #e6e8eb; --text-muted: #a2abb8; --text-faint: #6b7480;
    --border: #2c313a; --border-strong: #3d444f;
    --accent: #60a5fa; --warn: #f59e0b;
    --num-bg: #3f3410; --num-fg: #e8c66a;
    --code-bg: #22262e; --code-fg: #d6dae0;
    --exp-fg: #7ee2a8;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 28px 20px 60px;
    background: var(--bg); color: var(--text);
    font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    font-size: 14px; line-height: 1.6;
  }
  .wrap { max-width: 1040px; margin: 0 auto; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 6px; flex-wrap: wrap; }
  h1 { font-size: 19px; margin: 0; font-weight: 650; }
  .sub { color: var(--text-muted); font-size: 13px; margin: 4px 0 22px; }
  .badge {
    display: inline-block; font-size: 11px; padding: 3px 9px; border-radius: 999px;
    border: 1px solid var(--border-strong); background: var(--bg-elev); color: var(--text-muted);
  }
  button.theme {
    font: inherit; font-size: 12px; padding: 5px 12px; cursor: pointer;
    border: 1px solid var(--border-strong); background: var(--bg-elev);
    color: var(--text); border-radius: 6px;
  }
  button.theme:hover { background: var(--bg-hover); }
  .sample { margin-bottom: 34px; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
  .sample-head {
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
    padding: 9px 14px; background: var(--bg-elev); border-bottom: 1px solid var(--border);
    font-size: 13px; font-weight: 600;
  }
  .grid {
    display: grid; grid-template-columns: 46px minmax(120px, 0.9fr) minmax(240px, 2.1fr);
    align-items: stretch;
  }
  .cell { padding: 6px 10px; border-bottom: 1px solid var(--border); font-size: 12.5px; }
  .num {
    background: var(--num-bg); color: var(--num-fg); text-align: right;
    font-family: "JetBrains Mono", Consolas, monospace; font-size: 11px;
    border-right: 1px solid var(--border); user-select: none;
  }
  .code {
    background: var(--code-bg); color: var(--code-fg);
    border-right: 1px solid var(--border); white-space: pre; overflow-x: auto;
    font-family: "JetBrains Mono", Consolas, monospace; font-size: 11.5px;
  }
  .exp { background: var(--bg); color: var(--text); }
  .exp[data-kind="dict"]    { color: var(--exp-fg); box-shadow: inset 3px 0 0 var(--accent); }
  .exp[data-kind="syntax"]  { color: var(--text-muted); box-shadow: inset 3px 0 0 var(--border-strong); }
  .exp[data-kind="comment"] { color: var(--text-faint); font-style: italic; box-shadow: inset 3px 0 0 var(--text-faint); }
  .exp[data-kind="blank"]   { color: var(--text-faint); }
  .exp[data-kind="unknown"] { color: var(--text-faint); box-shadow: inset 3px 0 0 var(--warn); }
  .legend { display: flex; gap: 16px; flex-wrap: wrap; margin: 0 0 18px; font-size: 12px; color: var(--text-muted); }
  .legend span { display: inline-flex; align-items: center; gap: 6px; }
  .swatch { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
  .note {
    margin-top: 26px; padding: 12px 14px; border-radius: 8px;
    background: var(--bg-elev); border: 1px solid var(--border);
    color: var(--text-muted); font-size: 12.5px;
  }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div>
      <h1>离线模式 · 逐行解释效果预览</h1>
      <div class="sub">数据由 <code>src/main/offline/engine.ts</code> 真实生成 · 全程未联网</div>
    </div>
    <button class="theme" id="theme">切换暗色</button>
  </header>

  <div class="legend">
    <span><i class="swatch" style="background:var(--accent)"></i>📖 词典命中（库函数/内置函数，精确）</span>
    <span><i class="swatch" style="background:var(--border-strong)"></i>🔧 语法结构（模板化）</span>
    <span><i class="swatch" style="background:var(--text-faint)"></i>💬 注释 / 空行</span>
    <span><i class="swatch" style="background:var(--warn)"></i>❓ 离线未识别（需联网 AI）</span>
  </div>

${payload.map((p) => `  <section class="sample">
    <div class="sample-head"><span>${p.title}</span><span class="badge">${p.result.matched}/${p.result.total} 行可解释</span></div>
    <div class="grid">
${p.result.lines.map((l) => `      <div class="cell num">${l.n}</div>
      <div class="cell code">${escapeHtml(l.code)}</div>
      <div class="cell exp" data-kind="${l.kind}">${escapeHtml(l.explain)}</div>`).join('\n')}
    </div>
  </section>`).join('\n\n')}

  <div class="note">
    <strong>能力边界：</strong>离线引擎能精确解释 C 标准库函数（printf / malloc / strcpy / strlen …）与 Python 内置函数和常用方法（print / len / range / .get / .append …），
    也能识别控制流、声明、赋值、切片、推导式、f-string 等语法结构。
    但它是<strong>静态规则</strong>，无法理解"这段是冒泡排序"这类算法意图，也无法解释业务语义 —— 那部分仍需联网让 AI 完成。
  </div>
</div>
<script>
  var btn = document.getElementById('theme');
  btn.addEventListener('click', function () {
    var dark = document.body.classList.toggle('dark');
    btn.textContent = dark ? '切换亮色' : '切换暗色';
  });
</script>
</body>
</html>
`;

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const outPath = resolve(process.cwd(), 'preview/offline-preview.html');
writeFileSync(outPath, html, 'utf8');
console.log('已生成 ' + outPath);
for (const p of payload) {
  const kinds = p.result.lines.reduce((acc, l) => {
    acc[l.kind] = (acc[l.kind] || 0) + 1;
    return acc;
  }, {});
  console.log(`  ${p.title}: ${JSON.stringify(kinds)}`);
}
