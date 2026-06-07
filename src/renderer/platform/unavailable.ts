import type { PlatformAdapters } from './types';

function unavailable(feature: string): never {
  throw new Error(`${feature} is not available on this platform`);
}

export function createUnavailablePlatform(): PlatformAdapters {
  return {
    kind: 'web-unavailable',
    available: false,
    keyStore: {
      getKeys: async () => ({}),
      setKeys: async () => unavailable('secure key storage'),
      hasKeys: async () => false,
    },
    ocrClient: {
      parseDocument: async () => unavailable('OCR document parsing'),
    },
    llmClient: {
      chat: async () => unavailable('LLM chat'),
    },
    cache: {
      getStats: async () => ({ count: 0, bytes: 0 }),
      clear: async () => 0,
    },
  };
}
