/**
 * LLM OCR 后校正 — 基于 DeepSeek 的征信语境纠错
 *
 * 作为词典校正之后的兜底层，处理形近字词典覆盖不到的长尾错误
 * 将 OCR 文本分段发送给 LLM，让其基于征信报告语境做纠错
 *
 * 设计原则：
 * - 只纠错，不改变原文结构和语义
 * - 分段处理，避免超出 token 限制
 * - 失败时静默降级，返回原文
 */

import { debugWarn } from '../utils/debug-log';
import { getPlatformAdapters } from '../platform';

const SYSTEM_PROMPT = `你是一个 OCR 纠错专家，专门处理中国央行个人征信报告的 OCR 识别结果。

你的任务：
1. 修复形近字错误（如"窑福"→"幸福"、"佘额"→"余额"）
2. 修复因扫描模糊导致的汉字误识别
3. 修复数字与字母混淆（如"O"和"0"、"l"和"1"）
4. 保持金额数字、日期、证件号码的准确性

严格规则：
- 只修复明显的 OCR 识别错误，不要改变原文含义
- 不要添加、删除或重新组织任何内容
- 不要添加标点符号或改变格式
- 直接输出修正后的文本，不要任何解释或标记
- 如果没有发现错误，原样输出`;

/** 单次发送的最大字符数，避免超出 LLM token 限制 */
const CHUNK_SIZE = 3000;

/**
 * 使用 LLM 对 OCR 文本做语境纠错
 * 分段处理，每段独立调用 LLM，最后拼接
 */
export async function correctWithLLM(text: string): Promise<string> {
  if (!text.trim()) return text;

  const chunks = splitIntoChunks(text, CHUNK_SIZE);
  const corrected: string[] = [];

  for (const chunk of chunks) {
    const result = await correctChunk(chunk);
    corrected.push(result);
  }

  return corrected.join('\n');
}

/** 对单段文本调用 LLM 纠错，失败时返回原文 */
async function correctChunk(chunk: string): Promise<string> {
  try {
    const messages = [
      { role: 'system' as const, content: SYSTEM_PROMPT },
      { role: 'user' as const, content: `请修正以下征信报告 OCR 文本中的识别错误：\n\n${chunk}` },
    ];

    const result = await getPlatformAdapters().llmClient.chat(messages);
    if (!result || result.trim().length === 0) return chunk;

    // 基本校验：LLM 返回长度不应偏差太大，防止幻觉
    const lengthRatio = result.length / chunk.length;
    if (lengthRatio < 0.8 || lengthRatio > 1.2) {
      debugWarn('[LLM-OCR] length ratio abnormal: %.2f, using original', lengthRatio);
      return chunk;
    }

    return result;
  } catch (err) {
    debugWarn('[LLM-OCR] correction failed, using original text:', err);
    return chunk;
  }
}

/** 按行边界分段，每段不超过 maxSize 字符 */
function splitIntoChunks(text: string, maxSize: number): string[] {
  const lines = text.split('\n');
  const chunks: string[] = [];
  let current = '';

  for (const line of lines) {
    if (current.length + line.length + 1 > maxSize && current.length > 0) {
      chunks.push(current);
      current = '';
    }
    current += (current ? '\n' : '') + line;
  }

  if (current) chunks.push(current);
  return chunks;
}
