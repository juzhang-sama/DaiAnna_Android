import type { ApiKeys, PlatformAdapters } from './types';

export function hasElectronBridge(): boolean {
  return typeof window !== 'undefined' && typeof window.electron !== 'undefined';
}

export function createElectronPlatform(): PlatformAdapters {
  if (!hasElectronBridge()) {
    throw new Error('Electron bridge is not available');
  }

  return {
    kind: 'electron',
    available: true,
    keyStore: {
      getKeys: () => window.electron!.getApiKeys(),
      setKeys: (keys) => window.electron!.setApiKeys(toStringRecord(keys)),
      hasKeys: () => window.electron!.hasApiKeys(),
    },
    ocrClient: {
      parseDocument: (base64, fileName) => window.electron!.parseDocument(base64, fileName),
    },
    llmClient: {
      chat: (messages) => window.electron!.llmChat(messages),
    },
    cache: {
      getStats: () => window.electron!.getDocParserCacheStats(),
      clear: () => window.electron!.clearDocParserCache(),
    },
  };
}

function toStringRecord(keys: ApiKeys): Record<string, string> {
  const result: Record<string, string> = {};
  if (keys.textinAppId) result.textinAppId = keys.textinAppId;
  if (keys.textinSecretCode) result.textinSecretCode = keys.textinSecretCode;
  if (keys.deepseekApiKey) result.deepseekApiKey = keys.deepseekApiKey;
  return result;
}
