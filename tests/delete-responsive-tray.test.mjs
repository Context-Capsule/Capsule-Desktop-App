import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFile(resolve(root, path), 'utf8');

test('generic operations still finish on direct child termination', async () => {
  const source = await read('src-tauri/src/lib.rs');
  const start = source.indexOf('async fn run_operation');
  const end = source.indexOf('async fn cancel_operation', start);
  const implementation = source.slice(start, end);
  assert.match(implementation, /CommandEvent::Terminated\(payload\)/);
  assert.match(implementation, /operation\.terminated/);
  const terminated = implementation.slice(implementation.indexOf('CommandEvent::Terminated'));
  assert.match(terminated.slice(0, terminated.indexOf('_ => {}')), /break;/);
});

test('delete has a dedicated narrow Tauri path with authoritative termination', async () => {
  const rust = await read('src-tauri/src/lib.rs');
  const start = rust.indexOf('async fn delete_capsule');
  const end = rust.indexOf('async fn desktop_api_call', start);
  const implementation = rust.slice(start, end);
  assert.ok(start >= 0);
  assert.match(implementation, /sidecar\("capsule"\)/);
  assert.match(implementation, /\.args\(\["delete"\.to_owned\(\), name\.clone\(\)\]\)/);
  assert.doesNotMatch(implementation, /emit_operation|preferred_operation_directory|capsule_exists/);
  assert.match(implementation, /CommandEvent::Terminated[\s\S]*break;/);
});

test('delete bypasses window.confirm and the generic operation overlay', async () => {
  const app = await read('src/App.svelte');
  const bridge = await read('src/lib/bridge.ts');
  assert.doesNotMatch(app, /window\.confirm/);
  assert.match(app, /pendingDelete = request\.name/);
  assert.match(app, /await deleteCapsule\(name\)/);
  assert.match(app, /markCapsuleDeleted\(name\)/);
  assert.match(app, /<DeleteConfirmModal/);
  assert.match(bridge, /invoke<void>\('delete_capsule'/);
});

test('post-delete overview refresh can paint from the already-loaded cache', async () => {
  const bridge = await read('src/lib/bridge.ts');
  assert.match(bridge, /let overviewCache: OverviewData \| null = null/);
  assert.match(bridge, /serveCachedOverviewOnce/);
  assert.match(bridge, /capsules: overviewCache\.capsules\.filter/);
  assert.match(bridge, /overview\.reconcile/);
});

test('delete confirmation is app-native and destructive-action styled', async () => {
  const modal = await read('src/components/DeleteConfirmModal.svelte');
  const css = await read('src/delete-confirm.css');
  assert.match(modal, /<Modal title="Delete capsule\?"/);
  assert.match(modal, /Your project files are not touched/);
  assert.match(modal, /danger-button delete-confirm-submit/);
  assert.match(css, /delete-confirm-warning/);
  assert.match(css, /rgba\(255, 83, 83/);
});

test('sidebar toggle sits on the sidebar border and preserves a compact rail', async () => {
  const controller = await read('src/lib/responsive-sidebar.ts');
  const css = await read('src/responsive-sidebar.css');
  const config = JSON.parse(await read('src-tauri/tauri.conf.json'));
  const mainWindow = config.app.windows.find((window) => window.label === 'main');

  assert.match(controller, /SIDEBAR_BREAKPOINT = 820/);
  assert.match(controller, /sidebar\.append\(toggle\)/);
  assert.match(controller, /matchMedia/);
  assert.match(controller, /SIDEBAR_PREFERENCE_KEY/);
  assert.match(css, /--sidebar-collapsed-width: 72px/);
  assert.match(css, /position: absolute;[\s\S]*right: -15px/);
  assert.match(css, /sidebar-toggle\[data-state='collapsed'\] svg/);
  assert.match(css, /data-sidebar-label/);
  assert.ok(mainWindow.minWidth < 820);
});

test('quick WebView backing surface remains explicitly alpha-zero', async () => {
  const config = JSON.parse(await read('src-tauri/tauri.conf.json'));
  const quick = config.app.windows.find((window) => window.label === 'quick');
  assert.equal(quick.transparent, true);
  assert.equal(quick.backgroundColor, '#00000000');
  assert.equal(quick.shadow, false);
  assert.equal(quick.windowEffects, undefined);
});
