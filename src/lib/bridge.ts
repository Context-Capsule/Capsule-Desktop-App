import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Command } from '@tauri-apps/plugin-shell';
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

type DesktopEnvelope<T> = {
  api_version: number;
  ok: boolean;
  data?: T;
  error?: string;
};

export async function queryDesktop<T>(action: string, args: string[] = []): Promise<T> {
  return invoke<T>('query_desktop', { action, args });
}

function queryLiveSidecar<T>(): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const command = Command.sidecar('binaries/capsule', ['desktop', 'live']);
    const stdout: string[] = [];
    const stderr: string[] = [];
    let settled = false;

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    command.stdout.on('data', (chunk) => stdout.push(chunk));
    command.stderr.on('data', (chunk) => stderr.push(chunk));
    command.on('error', (error) => fail(new Error(`Context Capsule live discovery failed: ${error}`)));
    command.on('close', ({ code }) => {
      if (settled) return;
      const raw = stdout.join('\n').trim();
      const errorOutput = stderr.join('\n').trim();
      if (code !== 0) {
        fail(new Error(errorOutput || raw || `Context Capsule live discovery exited with code ${code ?? 'unknown'}`));
        return;
      }
      if (!raw) {
        fail(new Error(`Context Capsule live discovery returned no JSON${errorOutput ? `: ${errorOutput}` : ''}`));
        return;
      }

      let envelope: DesktopEnvelope<T>;
      try {
        envelope = JSON.parse(raw) as DesktopEnvelope<T>;
      } catch (error) {
        fail(new Error(`Context Capsule returned invalid live discovery JSON: ${error instanceof Error ? error.message : String(error)}`));
        return;
      }
      if (envelope.api_version !== DESKTOP_API_VERSION) {
        fail(new Error(`Desktop API mismatch: app expects ${DESKTOP_API_VERSION}, CLI provides ${envelope.api_version}`));
        return;
      }
      if (!envelope.ok) {
        fail(new Error(envelope.error || 'Context Capsule live discovery failed'));
        return;
      }
      if (envelope.data === undefined) {
        fail(new Error('Context Capsule live discovery returned no data'));
        return;
      }
      settled = true;
      resolve(envelope.data);
    });

    command.spawn().catch((error) => {
      fail(new Error(`Context Capsule live discovery could not start: ${error instanceof Error ? error.message : String(error)}`));
    });
  });
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

export const getOverview = () => queryDesktop<OverviewData>('overview');
export const getCapsule = (reference: string) => queryDesktop<any>('capsule', [reference]);
export const getHistory = (name: string) => queryDesktop<HistoryData>('history', [name]);
export const getDiff = (before: string, after: string) => queryDesktop<any>('diff', [before, after]);
export const getApplications = () => queryDesktop<any>('applications');
// `tauri-plugin-shell`'s Rust `Command::output()` waits for the whole receiver
// channel to close even after the direct child has emitted Terminated. Windows
// discovery probes can leave inherited pipe handles alive in descendants, so
// the CLI can finish successfully while the old IPC promise waits forever.
// The picker only needs this one read-only command: collect its output through
// the tightly scoped frontend sidecar permission and resolve on direct-child
// termination instead of pipe EOF.
export const getLiveWorkspace = () => queryLiveSidecar<any>();
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
