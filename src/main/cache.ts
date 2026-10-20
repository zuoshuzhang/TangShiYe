/**
 * 进程内 LRU 缓存（无依赖）。
 *
 * key = sha1(代码 + 检测到的语言 + 类型 "quick"|"detail" + 可选 mode)
 * 速览和详解会被缓存；追问对话不缓存。
 * 加 mode 维度：segmented / lineByLine 模式的详解互不覆盖。
 */

import * as crypto from 'crypto';

const MAX_ENTRIES = 100;

type CacheKind = 'quick' | 'detail';

function makeKey(code: string, language: string, kind: CacheKind, mode?: string): string {
  const h = crypto.createHash('sha1');
  h.update(kind);
  h.update('\x00');
  h.update(language);
  h.update('\x00');
  if (mode) {
    h.update(mode);
    h.update('\x00');
  }
  h.update(code);
  return h.digest('hex');
}

// Map 在 JS 中是按插入顺序遍历的，删除再插入即可实现 LRU
const store = new Map<string, string>();

export function cacheGet(code: string, language: string, kind: CacheKind, mode?: string): string | undefined {
  const key = makeKey(code, language, kind, mode);
  if (!store.has(key)) return undefined;
  const v = store.get(key)!;
  // 命中 → 移到末尾（最新）
  store.delete(key);
  store.set(key, v);
  return v;
}

export function cacheSet(code: string, language: string, kind: CacheKind, value: string, mode?: string): void {
  if (!value) return;
  const key = makeKey(code, language, kind, mode);
  if (store.has(key)) store.delete(key);
  store.set(key, value);
  while (store.size > MAX_ENTRIES) {
    const first = store.keys().next().value;
    if (first === undefined) break;
    store.delete(first);
  }
}

export function cacheStats(): { size: number; max: number } {
  return { size: store.size, max: MAX_ENTRIES };
}

export function cacheClear(): void {
  store.clear();
}
