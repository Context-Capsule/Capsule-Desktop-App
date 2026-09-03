import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type {
  DesktopContract,
  HistoryData,
  OperationEvent,
  OperationRequest,
  OperationResult,
  OverviewData,
  ServicesData
} from './types';

export const DESKTOP_API_VERSION = 1;
const REQUIRED_DESKTOP_FEATURES = ['live-workspace', 'services', 'log-paths'];
const FRONTEND_TRACE_KEY = 'context-capsule:frontend-trace:v1';
const FRONTEND_TRACE_LIMIT = 80;

type FrontendTraceEntry = {
  at: number;
  scope: string;
  message: string;
};

export function traceFrontend(scope: string, message: string) {
  const entry: FrontendTraceEntry = {
    at: Date.now(),
    scope: scope.slice(0, 80),
    message: message.slice(0, 800)
  };
  console.info(`[ContextCapsule:${entry.scope}] ${entry.message}`);
  try {
    const current = JSON.parse(localStorage.getItem(FRONTEND_TRACE_KEY) ?? '[]');
    const entries = Array.isArray(current) ? current.slice(-(FRONTEND_TRACE_LIMIT - 1)) : [];
    entries.push(entry);
    localStorage.setItem(FRONTEND_TRACE_KEY, JSON.stringify(entries));
  } catch {
    // Diagnostics must never interfere with the product path they observe.
  }
}

export function getFrontendTrace(): FrontendTraceEntry[] {
  try {
    const current = JSON.parse(localStorage.getItem(FRONTEND_TRACE_KEY) ?? '[]');
    return Array.isArray(current) ? current : [];
  } catch {
    return [];
  }
}

export async function queryDesktop<T>(action: string, args: string[] = []): Promise<T> {
  const started = performance.now();
  traceFrontend('bridge.invoke', `begin action=${action} args=${args.length}`);
  try {
    const value = await invoke<T>('query_desktop', { action, args });
    const elapsed = Math.round(performance.now() - started);
    const appCount = action === 'live' && value && typeof value === 'object' && Array.isArray((value as any).applications)
      ? (value as any).applications.length
      : null;
    traceFrontend('bridge.invoke', `resolved action=${action} elapsed_ms=${elapsed}${appCount === null ? '' : ` applications=${appCount}`}`);
    return value;
  } catch (error) {
    const elapsed = Math.round(performance.now() - started);
    traceFrontend('bridge.invoke', `rejected action=${action} elapsed_ms=${elapsed} error=${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

export async function contract(): Promise<DesktopContract> {
  const value = await queryDesktop<DesktopContract>('contract');
  if (value.api_version !== DESKTOP_API_VERSION) {
    throw new Error(`Desktop API mismatch: app expects ${DESKTOP_API_VERSION}, CLI provides ${value.api_version}`);
  }
  const features = Array.isArray(value.features) ? value.features : [];
  const missing = REQUIRED_DESKTOP_FEATURES.filter((feature) => !features.includes(feature));
  if (missing.length) {
    throw new Error(`Context Capsule CLI is missing required desktop feature(s): ${missing.join(', ')}`);
  }
  return value;
}

let overviewCache: OverviewData | null = null;
let serveCachedOverviewOnce = false;

export async function getOverview(): Promise<OverviewData> {
  if (serveCachedOverviewOnce && overviewCache) {
    serveCachedOverviewOnce = false;
    const snapshot = overviewCache;
    // Reconcile quietly after the UI has already removed the deleted capsule.
    // A failed background read must not resurrect stale data or block the user.
    void queryDesktop<OverviewData>('overview')
      .then((value) => { overviewCache = value; })
      .catch((error) => traceFrontend('overview.reconcile', `failed error=${error instanceof Error ? error.message : String(error)}`));
    return snapshot;
  }

  const value = await queryDesktop<OverviewData>('overview');
  overviewCache = value;
  return value;
}

export function markCapsuleDeleted(name: string) {
  if (!overviewCache) return;
  const normalized = name.trim().toLowerCase();
  overviewCache = {
    ...overviewCache,
    capsules: overviewCache.capsules.filter((capsule) => capsule.name.trim().toLowerCase() !== normalized)
  };
  serveCachedOverviewOnce = true;
}
export const getCapsule = (reference: string) => queryDesktop<any>('capsule', [reference]);
export const getHistory = (name: string) => queryDesktop<HistoryData>('history', [name]);
export const getDiff = (before: string, after: string) => queryDesktop<any>('diff', [before, after]);
export const getApplications = () => queryDesktop<any>('applications');
// Live Workspace and Save -> Advanced intentionally share this exact call.
// Keeping one read path prevents the save chooser from drifting into a separate
// sidecar lifecycle or application-discovery implementation.
export const getLiveWorkspace = () => queryDesktop<any>('live');
export const getHealth = () => queryDesktop<any>('health');
export const getServices = (reference: string) => queryDesktop<ServicesData>('services', [reference]);
export const getLogPaths = () => queryDesktop<Record<string, string>>('log-paths');

export const runOperation = (request: OperationRequest) =>
  invoke<OperationResult>('run_operation', { request });
export const deleteCapsule = (name: string) =>
  invoke<void>('delete_capsule', { name });
export const cancelOperation = (operationId: string) =>
  invoke<void>('cancel_operation', { operationId });

export const showMainWindow = (view?: string, capsule?: string) =>
  invoke<void>('show_main_window', { view: view ?? null, capsule: capsule ?? null });
export const hideQuickPanel = () => invoke<void>('hide_quick_panel');
export const quitApplication = () => invoke<void>('quit_application');
export const openPath = (path: string) => invoke<void>('open_path', { path });

export async function onOperationEvent(handler: (event: OperationEvent) => void) {
  return listen<OperationEvent>('operation-progress', ({ payload }) => handler(payload));
}

export async function onTrayAction(handler: (event: { action: 'save' | 'restore-last'; nonce: number }) => void) {
  return listen<{ action: 'save' | 'restore-last'; nonce: number }>('tray-action', ({ payload }) => handler(payload));
}

export async function onAppNavigation(handler: (event: { view?: string | null; capsule?: string | null }) => void) {
  return listen<{ view?: string | null; capsule?: string | null }>('app-navigation', ({ payload }) => handler(payload));
}
