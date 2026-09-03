import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(path, 'utf8');

test('native shared state owns busy operation lifecycle and data revision', async () => {
  const rust = await read('src-tauri/src/lib.rs');
  assert.match(rust, /struct SharedAppStateSnapshot/);
  assert.match(rust, /another Context Capsule operation is already running/);
  assert.match(rust, /app-state-changed/);
  assert.ok(rust.includes("self.data_revision = self.data_revision.wrapping_add(1);"));
  assert.ok(rust.includes(".manage(SharedAppState::default())"));
});

test('operation progress, cancellation and dismissal are synchronized', async () => {
  const rust = await read('src-tauri/src/lib.rs');
  const app = await read('src/App.svelte');
  assert.ok(rust.includes("state.progress(id, &clean, phase)"));
  assert.ok(rust.includes("state.set_cancelling(&operation_id)"));
  assert.match(app, /onSharedAppState/);
  assert.match(app, /getSharedAppState/);
  assert.match(app, /dismissSharedOperation/);
  assert.match(app, /sharedState.operationVisible/);
  assert.doesNotMatch(app, /let operationPhase = $state/);
});

test('save preparation no longer blocks sync behind frontend live discovery', async () => {
  const app = await read('src/App.svelte');
  const rust = await read('src-tauri/src/lib.rs');
  assert.doesNotMatch(app, /withInternalExclusions/);
  assert.doesNotMatch(app, /getLiveWorkspace/);
  assert.ok(rust.includes("add_internal_app_exclusion(&app, &mut request).await"));
});

test('settings and onboarding completion broadcast to both WebViews', async () => {
  const app = await read('src/App.svelte');
  const bridge = await read('src/lib/bridge.ts');
  const rust = await read('src-tauri/src/lib.rs');
  assert.match(app, /onSettingsChanged/);
  assert.match(app, /publishSettings/);
  assert.match(app, /onOnboardingDone/);
  assert.match(bridge, /settings-changed/);
  assert.match(rust, /publish_onboarding_done/);
});

test('both surfaces honor the same global busy state', async () => {
  const full = await read('src/components/FullApp.svelte');
  const quick = await read('src/components/QuickPanel.svelte');
  const card = await read('src/components/CapsuleCard.svelte');
  assert.match(full, /disabled={busy}/);
  assert.match(quick, /disabled={busy}/);
  assert.match(card, /disabled={disabled}/);
});
