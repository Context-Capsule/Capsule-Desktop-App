import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('full and quick use the same shared operation source in both directions', async () => {
  const app = await read('src/App.svelte');
  const bridge = await read('src/lib/bridge.ts');
  const rust = await read('src-tauri/src/lib.rs');

  assert.match(app, /let busy = \$derived\(sharedState\.busy\)/);
  assert.match(app, /let refreshVersion = \$derived\(sharedState\.dataRevision\)/);
  assert.match(app, /<QuickPanel \{settings\} \{busy\} \{refreshVersion\}[^>]*onSave=\{saveCapsule\}[^>]*onRestore=\{restoreCapsule\}/);
  assert.match(app, /<FullApp \{settings\} \{busy\} \{refreshVersion\}[^>]*onSave=\{saveCapsule\}[^>]*onRestore=\{restoreCapsule\}/);
  assert.match(app, /onSharedAppState\(acceptSharedState\)/);
  assert.match(app, /getSharedAppState\(\)\.then\(acceptSharedState\)/);
  assert.match(app, /const result = await runOperation\(request\)/);

  assert.match(bridge, /listen<SharedAppState>\('app-state-changed'/);
  assert.match(bridge, /invoke<SharedAppState>\('get_shared_app_state'\)/);
  assert.ok(rust.includes('app.emit("app-state-changed", snapshot.clone())'));
  assert.ok(rust.includes('.manage(SharedAppState::default())'));
});

test('late-opened window can recover an already-running operation snapshot', async () => {
  const app = await read('src/App.svelte');
  const rust = await read('src-tauri/src/lib.rs');
  assert.match(app, /const resyncSharedState = \(\) =>/);
  assert.match(app, /getSharedAppState\(\)\.then\(acceptSharedState\)/);
  assert.match(app, /resyncSharedState\(\);/);
  assert.ok(rust.includes("fn get_shared_app_state(shared: State<'_, SharedAppState>)"));
  assert.ok(rust.includes('state.begin(&operation_id, &request, true)'));
});

test('settings onboarding cancellation and data invalidation are global', async () => {
  const app = await read('src/App.svelte');
  const bridge = await read('src/lib/bridge.ts');
  const rust = await read('src-tauri/src/lib.rs');
  assert.match(app, /onSettingsChanged/);
  assert.match(app, /onOnboardingDone/);
  assert.match(app, /sharedState\.cancelable/);
  assert.match(app, /sharedState\.dataRevision/);
  assert.match(bridge, /settings-changed/);
  assert.match(bridge, /onboarding-done/);
  assert.ok(rust.includes('self.data_revision = self.data_revision.wrapping_add(1);'));
  assert.ok(rust.includes('state.set_cancelling(&operation_id)'));
});


test('hidden or refocused surface rehydrates authoritative shared state', async () => {
  const app = await read('src/App.svelte');
  assert.match(app, /const resyncSharedState = \(\) =>/);
  assert.match(app, /getSharedAppState\(\)\.then\(acceptSharedState\)/);
  assert.match(app, /window\.addEventListener\('focus', resyncSharedState\)/);
  assert.match(app, /document\.addEventListener\('visibilitychange', resyncWhenVisible\)/);
  assert.match(app, /window\.removeEventListener\('focus', resyncSharedState\)/);
  assert.match(app, /document\.removeEventListener\('visibilitychange', resyncWhenVisible\)/);
});


test('native show paths push the authoritative snapshot to the surface being revealed', async () => {
  const rust = await read('src-tauri/src/lib.rs');
  assert.ok(rust.includes('fn emit_shared_state_to_window<R: Runtime>'));
  assert.ok(rust.includes('window.emit("app-state-changed", snapshot)'));
  assert.match(rust, /fn show_quick[\s\S]*emit_shared_state_to_window\(app, "quick"\)/);
  assert.match(rust, /fn toggle_quick[\s\S]*emit_shared_state_to_window\(app, "quick"\)/);
  assert.match(rust, /fn show_main_window[\s\S]*emit_shared_state_to_window\(&app, "main"\)/);
});


test('shared busy state is released on sidecar startup failures', async () => {
  const rust = await read('src-tauri/src/lib.rs');
  assert.ok(rust.includes('fn fail_shared_operation('));
  assert.match(rust, /sidecar\("capsule"\)[\s\S]*fail_shared_operation\(&app, shared\.inner\(\), &operation_id\)/);
  assert.match(rust, /let code = match termination_code[\s\S]*fail_shared_operation\(&app, shared\.inner\(\), &operation_id\)/);
  assert.match(rust, /sidecar\(program\)[\s\S]*fail_shared_operation\(&app, shared\.inner\(\), &operation_id\)/);
});
