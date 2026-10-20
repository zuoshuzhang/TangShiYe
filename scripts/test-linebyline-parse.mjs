// 单测：lineByLine JSON 解析容错（对应 src/main/llm/llmService.ts 的 tryParseLineByLineJson）
function tryParseLineByLineJson(raw) {
  if (!raw) return null;
  let s = raw.trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) s = fence[1].trim();
  const firstBrace = s.indexOf('{');
  if (firstBrace > 0) s = s.slice(firstBrace);
  const lastBrace = s.lastIndexOf('}');
  if (lastBrace >= 0 && lastBrace < s.length - 1) s = s.slice(0, lastBrace + 1);
  try {
    const obj = JSON.parse(s);
    if (obj && Array.isArray(obj.lines)) {
      return obj.lines
        .filter((x) => x && typeof x.n === 'number' && typeof x.code === 'string' && typeof x.explain === 'string')
        .map((x) => ({ n: x.n, code: x.code, explain: x.explain }));
    }
  } catch { /* fallthrough */ }
  const m = s.match(/\{\s*"lines"\s*:\s*\[([\s\S]*?)\]\s*\}/);
  if (m) {
    try {
      const obj = JSON.parse('{"lines":[' + m[1] + ']}');
      if (Array.isArray(obj.lines)) {
        return obj.lines
          .filter((x) => x && typeof x.n === 'number' && typeof x.code === 'string' && typeof x.explain === 'string')
          .map((x) => ({ n: x.n, code: x.code, explain: x.explain }));
      }
    } catch { /* fallthrough */ }
  }
  return null;
}

const cases = [
  {
    name: '1. 干净 JSON（理想情况）',
    input: '{"lines":[{"n":1,"code":"def add(a, b):","explain":"定义函数 add"},{"n":2,"code":"    return a + b","explain":"返回 a+b"}]}',
    expect: 2,
  },
  {
    name: '2. markdown ```json 围栏包裹',
    input: '```json\n{"lines":[{"n":1,"code":"int *p;","explain":"声明 int 指针 p"},{"n":2,"code":"p = &x;","explain":"p 取 x 的地址"}]}\n```',
    expect: 2,
  },
  {
    name: '3. 前后有噪声话术',
    input: '好的，以下是逐行解释：\n{"lines":[{"n":1,"code":"for i in range(10):","explain":"循环 0 到 9"}]}\n希望对你有帮助！',
    expect: 1,
  },
  {
    name: '4. 代码含转义引号与换行',
    input: '{"lines":[{"n":1,"code":"printf(\\"hello\\\\n\\");","explain":"打印 hello 并换行"},{"n":2,"code":"return 0;","explain":"程序正常退出"}]}',
    expect: 2,
  },
  {
    name: '5. 空数组（空代码）',
    input: '{"lines":[]}',
    expect: 0,
  },
  {
    name: '6. 完全非法（应返回 null 触发降级）',
    input: '这是一段完全不是 JSON 的文本',
    expect: null,
  },
  {
    name: '7. 空输入',
    input: '',
    expect: null,
  },
];

let pass = 0, fail = 0;
for (const c of cases) {
  const got = tryParseLineByLineJson(c.input);
  const gotLen = got === null ? null : got.length;
  const ok = gotLen === c.expect;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}  → 解析 ${gotLen === null ? 'null(降级)' : gotLen + ' 行'}`);
  if (!ok) {
    console.log(`      期望 ${c.expect}，实到 ${gotLen}`);
    fail++;
  } else {
    pass++;
    // 对通过的用例，展示第一行渲染内容（验证 code/explain 字段正确）
    if (got && got.length > 0) {
      console.log(`      首行: [${got[0].n}] ${JSON.stringify(got[0].code)} → ${got[0].explain}`);
    }
  }
}
console.log(`\n结果: ${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
