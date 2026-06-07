import { createCapacitorPlatform, hasCapacitorNativeRuntime } from './capacitor';
import { createElectronPlatform, hasElectronBridge } from './electron';
import { createUnavailablePlatform } from './unavailable';
import type { PlatformAdapters } from './types';

let cachedPlatform: PlatformAdapters | null = null;

export function getPlatformAdapters(): PlatformAdapters {
  if (cachedPlatform) return cachedPlatform;

  if (hasElectronBridge()) {
    cachedPlatform = createElectronPlatform();
  } else if (hasCapacitorNativeRuntime()) {
    cachedPlatform = createCapacitorPlatform();
  } else {
    cachedPlatform = createUnavailablePlatform();
  }

  return cachedPlatform;
}

export function resetPlatformAdaptersForTests(): void {
  cachedPlatform = null;
}

export type {
  ApiKeys,
  ChatMessage,
  DocumentInput,
  PlatformAdapters,
  PlatformCache,
  PlatformFileAdapter,
  PlatformKeyStore,
  PlatformLlmClient,
  PlatformOcrClient,
  PlatformShare,
  ShareFileDataInput,
} from './types';
