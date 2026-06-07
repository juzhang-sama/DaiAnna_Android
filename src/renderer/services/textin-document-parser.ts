import type { DocParserResult } from '../../shared/doc-parser-types';
import { getPlatformAdapters } from '../platform';

/**
 * 通过当前平台适配器调用 TextIn 文档解析。
 * 接收 PDF/图片 base64，返回统一的结构化文档解析结果。
 */
export async function parseDocument(
  fileBase64: string, fileName: string,
): Promise<DocParserResult> {
  return getPlatformAdapters().ocrClient.parseDocument(fileBase64, fileName);
}
