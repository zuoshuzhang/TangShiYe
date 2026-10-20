/**
 * 获取选中代码。
 *
 * 阶段二（MVP）实现：直接读取剪贴板。
 * 用户工作流：选中代码 → Ctrl+C → 双击 Ctrl。
 *
 * 阶段五（P1, 4.9）会增强为：保存剪贴板 → 模拟 Ctrl+C → 读 → 恢复。
 */

import { clipboard } from 'electron';

export interface AcquiredCode {
  code: string;
  source: 'clipboard';
}

const MAX_CODE_LENGTH = 8000; // 截断保护，避免巨大文本

export async function acquireSelectedCode(): Promise<AcquiredCode | null> {
  const text = clipboard.readText();
  if (!text || !text.trim()) return null;

  const trimmed = text.length > MAX_CODE_LENGTH ? text.slice(0, MAX_CODE_LENGTH) : text;
  return { code: trimmed, source: 'clipboard' };
}
