import type { DocParserResult } from '../../shared/doc-parser-types';

export interface ApiKeys {
  textinAppId?: string;
  textinSecretCode?: string;
  deepseekApiKey?: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface DocumentInput {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  source: 'camera' | 'gallery' | 'file';
  uri?: string;
  base64?: string;
}

export interface PlatformFileAdapter {
  pickFiles(): Promise<DocumentInput[]>;
  takePhoto(): Promise<DocumentInput>;
  readAsBase64(input: DocumentInput): Promise<string>;
}

export interface PlatformKeyStore {
  getKeys(): Promise<ApiKeys>;
  setKeys(keys: ApiKeys): Promise<void>;
  hasKeys(): Promise<boolean>;
}

export interface PlatformOcrClient {
  parseDocument(base64: string, fileName: string): Promise<DocParserResult>;
}

export interface PlatformLlmClient {
  chat(messages: ChatMessage[]): Promise<string>;
}

export interface PlatformCache {
  getStats(): Promise<{ count: number; bytes: number }>;
  clear(): Promise<number>;
}

export interface ShareFileDataInput {
  fileName: string;
  mimeType: string;
  base64: string;
}

export interface PlatformShare {
  shareFile(path: string, mimeType: string): Promise<void>;
  shareFileData?(input: ShareFileDataInput): Promise<void>;
  shareText(text: string): Promise<void>;
}

export interface PlatformAdapters {
  kind: 'electron' | 'capacitor' | 'web-unavailable';
  available: boolean;
  keyStore: PlatformKeyStore;
  ocrClient: PlatformOcrClient;
  llmClient: PlatformLlmClient;
  cache: PlatformCache;
  share?: PlatformShare;
  files?: PlatformFileAdapter;
}
