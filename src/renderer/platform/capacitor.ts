import { Capacitor } from '@capacitor/core';
import {
  Camera,
  EncodingType,
  MediaType,
  MediaTypeSelection,
  type MediaResult,
} from '@capacitor/camera';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { FilePicker, type PickedFile } from '@capawesome/capacitor-file-picker';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import { convertTextInResponse, type TextInResponse } from '../../shared/textin-doc-parser-adapter';
import type { ApiKeys, ChatMessage, DocumentInput, PickFilesOptions, PlatformAdapters, ShareFileDataInput } from './types';
import type { DocParserResult } from '../../shared/doc-parser-types';

const TEXTIN_PARSE_URL = 'https://api.textin.com/ai/service/v1/pdf_to_markdown';
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
const DEEPSEEK_MODEL = 'deepseek-chat';
const DEEPSEEK_MAX_TOKENS = 2048;
const DEEPSEEK_TEMPERATURE = 0.3;
const API_KEYS_STORAGE_KEY = 'api-keys';
const SECURE_STORAGE_PREFIX = 'loan-intelligence-parser_';
const DOC_CACHE_DIR = 'doc-parser-cache';
const EXPORT_DIR = 'exports';
const DOC_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const FILE_PICKER_ACCEPTED_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/bmp',
  'image/tiff',
  'image/webp',
];
const MAX_PICKED_FILE_SIZE_BYTES = 30 * 1024 * 1024;

let secureStorageReady: Promise<void> | null = null;

export function hasCapacitorNativeRuntime(): boolean {
  return typeof window !== 'undefined' && Capacitor.isNativePlatform();
}

export function createCapacitorPlatform(): PlatformAdapters {
  return {
    kind: 'capacitor',
    available: true,
    keyStore: {
      getKeys,
      setKeys,
      hasKeys,
    },
    ocrClient: {
      parseDocument: parseDocumentViaTextIn,
    },
    llmClient: {
      chat: chatViaDeepSeek,
    },
    cache: {
      getStats: getDocCacheStats,
      clear: clearDocCache,
    },
    share: {
      shareFile: async (path, mimeType) => {
        await Share.share({
          title: '征信报告',
          files: [path],
          dialogTitle: mimeType,
        });
      },
      shareFileData: shareFileData,
      shareText: async (text) => {
        await Share.share({
          title: '征信报告摘要',
          text,
          dialogTitle: '分享征信报告摘要',
        });
      },
    },
    files: {
      pickFiles,
      takePhoto,
      readAsBase64,
    },
  };
}

async function shareFileData(input: ShareFileDataInput): Promise<void> {
  await ensureExportDir();
  const fileName = sanitizeNativeFileName(input.fileName);
  const result = await Filesystem.writeFile({
    path: `${EXPORT_DIR}/${fileName}`,
    directory: Directory.Cache,
    data: stripDataUrlPrefix(input.base64),
  });

  await Share.share({
    title: fileName,
    files: [result.uri],
    dialogTitle: '分享 Word 报告',
  });
}

async function ensureSecureStoragePrefix(): Promise<void> {
  secureStorageReady ??= SecureStorage.setKeyPrefix(SECURE_STORAGE_PREFIX);
  return secureStorageReady;
}

async function getKeys(): Promise<ApiKeys> {
  await ensureSecureStoragePrefix();
  const value = await SecureStorage.get(API_KEYS_STORAGE_KEY);
  return isApiKeys(value) ? value : {};
}

async function setKeys(keys: ApiKeys): Promise<void> {
  await ensureSecureStoragePrefix();
  const existing = await getKeys();
  await SecureStorage.set(API_KEYS_STORAGE_KEY, { ...existing, ...keys });
}

async function hasKeys(): Promise<boolean> {
  const keys = await getKeys();
  return Boolean(keys.textinAppId && keys.textinSecretCode && keys.deepseekApiKey);
}

function isApiKeys(value: unknown): value is ApiKeys {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

async function parseDocumentViaTextIn(base64: string, fileName: string): Promise<DocParserResult> {
  const cached = await readDocCache(base64);
  if (cached) return cached;

  const keys = await getKeys();
  if (!keys.textinAppId || !keys.textinSecretCode) {
    throw new Error('TextIn API keys are not configured');
  }

  const response = await fetch(`${TEXTIN_PARSE_URL}?dpi=144&remove_watermark=1&paratext_mode=body`, {
    method: 'POST',
    headers: {
      'x-ti-app-id': keys.textinAppId,
      'x-ti-secret-code': keys.textinSecretCode,
      'Content-Type': 'application/octet-stream',
    },
    body: base64ToArrayBuffer(base64),
  });

  if (!response.ok) {
    throw new Error(`textin api request failed: ${response.status}`);
  }

  const data = await response.json() as TextInResponse;
  if (data.code !== 200) {
    throw new Error(`textin error: ${data.code} ${data.message}`);
  }

  const result = convertTextInResponse(data, fileName);
  await writeDocCache(base64, result);
  return result;
}

async function chatViaDeepSeek(messages: ChatMessage[]): Promise<string> {
  const keys = await getKeys();
  if (!keys.deepseekApiKey) {
    throw new Error('DeepSeek API key is not configured');
  }

  const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${keys.deepseekApiKey}`,
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages,
      max_tokens: DEEPSEEK_MAX_TOKENS,
      temperature: DEEPSEEK_TEMPERATURE,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`deepseek api error: ${response.status} ${body}`);
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('deepseek api returned empty choices');
  return content;
}

async function takePhoto(): Promise<DocumentInput> {
  await Camera.requestPermissions({ permissions: ['camera'] });
  const photo = await Camera.takePhoto({
    quality: 92,
    targetWidth: 1800,
    correctOrientation: true,
    encodingType: EncodingType.JPEG,
    saveToGallery: false,
    includeMetadata: true,
  });
  return mediaResultToInput(photo, 'camera', 0);
}

async function pickFiles(options: PickFilesOptions = {}): Promise<DocumentInput[]> {
  return options.source === 'images' ? pickGalleryImages() : pickDocumentFiles();
}

async function pickDocumentFiles(): Promise<DocumentInput[]> {
  const result = await FilePicker.pickFiles({
    types: FILE_PICKER_ACCEPTED_TYPES,
    readData: true,
  });
  return result.files.map((item, index) => pickedFileToInput(item, 'file', index));
}

async function pickGalleryImages(): Promise<DocumentInput[]> {
  try {
    const result = await FilePicker.pickImages({
      readData: false,
      limit: 0,
    });
    return result.files.map((item, index) => pickedFileToInput(item, 'gallery', index));
  } catch (err) {
    if (isNativePickerCancel(err)) throw err;
    return pickGalleryImagesViaCamera();
  }
}

async function pickGalleryImagesViaCamera(): Promise<DocumentInput[]> {
  const result = await Camera.chooseFromGallery({
    mediaType: MediaTypeSelection.Photo,
    allowMultipleSelection: true,
    quality: 92,
    targetWidth: 1800,
    correctOrientation: true,
    includeMetadata: true,
  });
  return result.results.map((item, index) => mediaResultToInput(item, 'gallery', index));
}

async function readAsBase64(input: DocumentInput): Promise<string> {
  if (input.base64) return input.base64;
  if (!input.uri) throw new Error(`Document input ${input.id} does not have a uri`);

  const fetched = await readUriViaFetch(input.uri).catch(() => null);
  if (fetched) return fetched;

  const result = await Filesystem.readFile({ path: input.uri });
  if (typeof result.data === 'string') return stripDataUrlPrefix(result.data);
  return blobToBase64(result.data);
}

async function readUriViaFetch(uri: string): Promise<string> {
  const response = await fetch(uri);
  if (!response.ok) {
    throw new Error(`failed to read uri via fetch: ${response.status}`);
  }
  return blobToBase64(await response.blob());
}

function mediaResultToInput(
  media: MediaResult,
  source: DocumentInput['source'],
  index: number,
): DocumentInput {
  if (media.type !== MediaType.Photo) {
    throw new Error('Only photo media is supported');
  }

  const format = normalizeImageFormat(media.metadata?.format);
  const id = `${source}-${Date.now()}-${index}`;
  return {
    id,
    name: `${id}.${format}`,
    mimeType: `image/${format === 'jpg' ? 'jpeg' : format}`,
    size: media.metadata?.size ?? 0,
    source,
    uri: media.uri ?? media.webPath,
    base64: media.uri || media.webPath ? undefined : media.thumbnail ? stripDataUrlPrefix(media.thumbnail) : undefined,
  };
}

function pickedFileToInput(
  file: PickedFile,
  source: DocumentInput['source'],
  index: number,
): DocumentInput {
  if (file.size > MAX_PICKED_FILE_SIZE_BYTES) {
    throw new Error(`文件 ${file.name} 超过 30MB，请压缩后再导入`);
  }

  const mimeType = normalizeMimeType(file.mimeType, file.name);
  const name = normalizePickedFileName(file.name, `${source}-${Date.now()}-${index}`, mimeType);
  return {
    id: `${source}-${Date.now()}-${index}`,
    name,
    mimeType,
    size: file.size,
    source,
    uri: file.path,
    base64: file.data ? stripDataUrlPrefix(file.data) : undefined,
  };
}

function normalizeMimeType(mimeType: string | undefined, fileName: string): string {
  if (mimeType) return mimeType;
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith('.pdf')) return 'application/pdf';
  if (lowerName.endsWith('.png')) return 'image/png';
  if (lowerName.endsWith('.webp')) return 'image/webp';
  if (lowerName.endsWith('.bmp')) return 'image/bmp';
  if (lowerName.endsWith('.tif') || lowerName.endsWith('.tiff')) return 'image/tiff';
  return 'image/jpeg';
}

function extensionFromMimeType(mimeType: string): string {
  if (mimeType === 'application/pdf') return '.pdf';
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'image/bmp') return '.bmp';
  if (mimeType === 'image/tiff') return '.tiff';
  return '.jpg';
}

function normalizePickedFileName(fileName: string | undefined, fallbackBase: string, mimeType: string): string {
  const safeName = fileName?.trim() || fallbackBase;
  const lowerName = safeName.toLowerCase();
  const hasKnownExtension = mimeType === 'application/pdf'
    ? lowerName.endsWith('.pdf')
    : IMAGE_EXTENSIONS_FOR_NAME.some((ext) => lowerName.endsWith(ext));
  return hasKnownExtension ? safeName : `${safeName}${extensionFromMimeType(mimeType)}`;
}

const IMAGE_EXTENSIONS_FOR_NAME = ['.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.tif', '.webp'];

function normalizeImageFormat(format: string | undefined): string {
  if (!format) return 'jpg';
  const normalized = format.toLowerCase();
  return normalized === 'jpeg' ? 'jpg' : normalized;
}

function isNativePickerCancel(err: unknown): boolean {
  return nativeErrorText(err).includes('cancel');
}

function nativeErrorText(err: unknown): string {
  if (err instanceof Error) return `${err.name} ${err.message}`.toLowerCase();
  if (typeof err === 'string') return err.toLowerCase();
  if (!err || typeof err !== 'object') return '';
  const payload = err as { code?: unknown; message?: unknown; errorMessage?: unknown };
  return [payload.code, payload.message, payload.errorMessage]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();
}

async function readDocCache(base64: string): Promise<DocParserResult | null> {
  try {
    const key = await computeHash(base64);
    const result = await Filesystem.readFile({
      path: `${DOC_CACHE_DIR}/${key}.json`,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
    if (typeof result.data !== 'string') return null;
    const cached = JSON.parse(result.data) as { createdAt: number; result: DocParserResult };
    if (Date.now() - cached.createdAt > DOC_CACHE_TTL_MS) {
      await Filesystem.deleteFile({
        path: `${DOC_CACHE_DIR}/${key}.json`,
        directory: Directory.Cache,
      }).catch(() => undefined);
      return null;
    }
    return cached.result;
  } catch {
    return null;
  }
}

async function writeDocCache(base64: string, result: DocParserResult): Promise<void> {
  try {
    await ensureDocCacheDir();
    const key = await computeHash(base64);
    await Filesystem.writeFile({
      path: `${DOC_CACHE_DIR}/${key}.json`,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
      data: JSON.stringify({ createdAt: Date.now(), result }),
    });
  } catch {
    // Cache writes should never block report parsing.
  }
}

async function getDocCacheStats(): Promise<{ count: number; bytes: number }> {
  try {
    await ensureDocCacheDir();
    const entries = await Filesystem.readdir({
      path: DOC_CACHE_DIR,
      directory: Directory.Cache,
    });
    const files = entries.files.filter((file) => file.type === 'file' && file.name.endsWith('.json'));
    return {
      count: files.length,
      bytes: files.reduce((sum, file) => sum + file.size, 0),
    };
  } catch {
    return { count: 0, bytes: 0 };
  }
}

async function clearDocCache(): Promise<number> {
  const stats = await getDocCacheStats();
  await Filesystem.rmdir({
    path: DOC_CACHE_DIR,
    directory: Directory.Cache,
    recursive: true,
  }).catch(() => undefined);
  return stats.count;
}

async function ensureDocCacheDir(): Promise<void> {
  await Filesystem.mkdir({
    path: DOC_CACHE_DIR,
    directory: Directory.Cache,
    recursive: true,
  }).catch(() => undefined);
}

async function ensureExportDir(): Promise<void> {
  await Filesystem.mkdir({
    path: EXPORT_DIR,
    directory: Directory.Cache,
    recursive: true,
  }).catch(() => undefined);
}

function sanitizeNativeFileName(fileName: string): string {
  const sanitized = fileName.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').trim();
  return sanitized || `report-${Date.now()}.docx`;
}

async function computeHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(stripDataUrlPrefix(base64));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const bytes = base64ToUint8Array(base64);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function stripDataUrlPrefix(value: string): string {
  return value.replace(/^data:[^;]+;base64,/, '');
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(stripDataUrlPrefix(String(reader.result ?? '')));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'));
    reader.readAsDataURL(blob);
  });
}
