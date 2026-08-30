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

export async function queryDesktop<T>(action: string, args: string[] = []): Promise<T> {
  return invoke<T>('query_desktop', { action, args });
}

export async function contract(): Promise<DesktopContract> {
  const value = await queryDesktop<DesktopContract>('contract');
  if (value.api_version !== DESKTOP_API_VERSION) {
    throw new Error(`Desktop API mismatch: app expects ${DESKTOP_API_VERSION}, CLI provides ${value.api_version}`);
  }
  return value;
}

export const getOverview = () => queryDesktop<OverviewData>('overview');
export const getCapsule = (reference: string) => queryDesktop<any>('capsule', [reference]);
export const getHistory = (name: string) => queryDesktop<HistoryData>('history', [name]);
export const getDiff = (before: string, after: string) => queryDesktop<any>('diff', [before, after]);
export const getApplications = () => queryDesktop<any>('applications');
export const getLiveWorkspace = () => queryDesktop<any>('live');
export const getHealth = () => queryDesktop<any>('health');
export const getServices = (reference: string) => queryDesktop<ServicesData>('services', [reference]);
export const getLogPaths = () => queryDesktop<Record<string, string>>('log-paths');

export const runOperation = (request: OperationRequest) =>
  invoke<OperationResult>('run_operation', { request });
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
