import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFile(resolve(root, path), 'utf8');

test('save advanced uses the exact same live-workspace API path as the main Live Workspace view', async () => {
  const source = await read('src/components/SaveModal.svelte');
  const fullApp = await read('src/components/FullApp.svelte');
  const bridge = await read('src/lib/bridge.ts');
  const capability = JSON.parse(await read('src-tauri/capabilities/default.json'));
  const packageJson = JSON.parse(await read('package.json'));

  assert.doesNotMatch(source, /APPLICATION_DISCOVERY_TIMEOUT_MS/);
  assert.doesNotMatch(source, /Promise\.race/);
  assert.doesNotMatch(source, /Application discovery timed out/);
  assert.doesNotMatch(source, /onMount\([\s\S]*loadApplications/);
  assert.match(source, /const live = await getLiveWorkspace\(\)/);
  assert.match(fullApp, /live = await getLiveWorkspace\(\)/);
  assert.match(bridge, /getLiveWorkspace = \(\) => queryDesktop<any>\('live'\)/);
  assert.doesNotMatch(bridge, /Command\.sidecar/);
  assert.doesNotMatch(bridge, /queryLiveSidecar/);
  assert.equal(packageJson.dependencies?.['@tauri-apps/plugin-shell'], undefined);
  assert.equal(capability.permissions.some((permission) => {
    if (typeof permission === 'string') return permission.includes('shell');
    return String(permission?.identifier ?? '').includes('shell');
  }), false);
  assert.match(source, /function toggleAdvanced\(\)[\s\S]*if \(advanced && !loadingApps && !detectedApps\.length\) void loadApplications\(\)/);
  assert.match(source, /loadApplications\(true\)/);
  assert.doesNotMatch(source, /<small>\{app\.executable_path\}<\/small>/);
});

test('save application renderer deduplicates name selectors and exposes frontend diagnostics instead of failing silently', async () => {
  const source = await read('src/components/SaveModal.svelte');
  const bridge = await read('src/lib/bridge.ts');
  const main = await read('src/main.ts');

  assert.match(source, /function uniqueApplications/);
  assert.match(source, /const seen = new Set<string>\(\)/);
  assert.match(source, /duplicate_names=/);
  assert.match(source, /\{#each detectedApps as app\}/);
  assert.doesNotMatch(source, /\{#each detectedApps as app \(app\.name\)\}/);
  assert.match(source, /Stage: \{debugStage\}/);
  assert.match(source, /Copy diagnostics/);
  assert.match(source, /traceFrontend\('save\.apps\.load'/);
  assert.match(source, /rows-assigned detected=/);
  assert.match(source, /finally elapsed_ms=/);

  assert.match(bridge, /FRONTEND_TRACE_KEY/);
  assert.match(bridge, /traceFrontend\('bridge\.invoke', `begin action=/);
  assert.match(bridge, /resolved action=\$\{action\}/);
  assert.match(bridge, /localStorage\.setItem\(FRONTEND_TRACE_KEY/);
  assert.match(main, /window\.addEventListener\('error'/);
  assert.match(main, /window\.addEventListener\('unhandledrejection'/);
  assert.match(main, /traceFrontend\('webview\.error'/);
});

test('save dialog keeps Zen safety explicit and gives the extension reconnect loop enough time after host repair', async () => {
  const source = await read('src/components/SaveModal.svelte');
  assert.match(source, /zenApp = applications\.find\(isZenApplication\)/);
  assert.match(source, /firefoxFresh = Boolean\(live\?\.browsers\?\.firefox\)/);
  assert.match(source, /runOperation\(\{ kind: 'install-browser-host', browser: 'firefox' \}\)/);
  assert.match(source, /setTimeout\(resolve, 5_300\)/);
  assert.match(source, /if \(browserStateKnown && zenApp && !firefoxFresh && !zenIgnored\)/);
  assert.match(source, /Repair connection/);
  assert.match(source, /explicitly ignore Zen/);
  assert.match(source, /internalSelector \? \[internalSelector\]/);
});

test('save publishes shared progress before native self-exclusion discovery', async () => {
  const app = await read('src/App.svelte');
  const rust = await read('src-tauri/src/lib.rs');
  assert.match(app, /getSharedAppState/);
  assert.match(app, /onSharedAppState/);
  assert.doesNotMatch(app, /withInternalExclusions/);
  assert.doesNotMatch(app, /getLiveWorkspace/);
  const begin = rust.indexOf('state.begin(&operation_id, &request, true)');
  const exclusion = rust.indexOf('add_internal_app_exclusion(&app, &mut request).await');
  assert.ok(begin >= 0, 'native shared operation begin missing');
  assert.ok(exclusion > begin, 'self-exclusion discovery still runs before shared progress begins');
  assert.match(rust, /desktop_api_call\(app, "live", &\[\]\)\.await/);
  assert.match(rust, /is_context_capsule_application/);
});

test('desktop runtime and packaging contracts reject feature-incomplete sidecars', async () => {
  const bridge = await read('src/lib/bridge.ts');
  const prepare = await read('scripts/prepare-sidecar.mjs');
  assert.match(bridge, /REQUIRED_DESKTOP_FEATURES = \['live-workspace', 'services', 'log-paths'\]/);
  assert.match(bridge, /const missing = REQUIRED_DESKTOP_FEATURES\.filter/);
  assert.match(bridge, /missing required desktop feature/);
  assert.match(prepare, /requiredDesktopFeatures = \['live-workspace', 'services', 'log-paths', 'application-discovery'\]/);
  assert.match(prepare, /const missing = requiredDesktopFeatures\.filter/);
  assert.match(prepare, /missing required feature\(s\)/);
});

test('quick save progress is explicitly centered and remains rectangular-backdrop-free', async () => {
  const component = await read('src/components/OperationOverlay.svelte');
  const css = await read('src/glass-overrides.css');
  assert.match(component, /data-window-mode='quick'\] \.operation-overlay\)[\s\S]*display: flex !important;[\s\S]*align-items: center !important;[\s\S]*justify-content: center !important/);
  assert.match(component, /data-window-mode='quick'\] \.operation-shell\)[\s\S]*margin: auto !important;[\s\S]*align-self: center !important/);
  assert.match(css, /html\[data-window-mode='quick'\] \.modal-backdrop,[\s\S]*html\[data-window-mode='quick'\] \.operation-overlay[\s\S]*background: transparent !important;[\s\S]*backdrop-filter: none !important/);
  assert.match(css, /quick-panel[\s\S]*rgba\(11,14,9,\.58\)[\s\S]*rgba\(5,7,5,\.66\)/);
  assert.match(css, /html\[data-window-mode='quick'\] \.operation-card \{ background: rgba\(7,9,6,\.94\) !important; \}/);
});

test('shared quick modal layout is centered, viewport-bounded and internally scrollable', async () => {
  const modal = await read('src/components/Modal.svelte');
  const css = await read('src/glass-overrides.css');
  assert.match(modal, /class="modal-scroll"/);
  assert.match(css, /\.modal-content \{[\s\S]*display: flex;[\s\S]*flex-direction: column;[\s\S]*overflow: hidden;/);
  assert.match(css, /\.modal-scroll \{[\s\S]*overflow-x: hidden;[\s\S]*overflow-y: auto;[\s\S]*scrollbar-width: none;/);
  assert.match(css, /html\[data-window-mode='quick'\] \.modal-backdrop \{[\s\S]*display: flex !important;[\s\S]*align-items: center !important;[\s\S]*justify-content: center !important;[\s\S]*overflow: hidden !important;/);
  assert.match(css, /html\[data-window-mode='quick'\] \.modal-shell \{[\s\S]*max-width: calc\(100vw - 20px\) !important;[\s\S]*max-height: calc\(100vh - 20px\) !important;[\s\S]*margin: auto !important;/);
  assert.match(css, /html\[data-window-mode='quick'\] \.restore-summary-grid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
  assert.match(css, /html\[data-window-mode='quick'\] \.service-choice \{[\s\S]*flex-direction: column;/);
});

test('quick onboarding follows the same bounded transparent-window contract', async () => {
  const css = await read('src/glass-overrides.css');
  assert.match(css, /html\[data-window-mode='quick'\] \.onboarding-shell \{[\s\S]*max-width: calc\(100vw - 20px\) !important;[\s\S]*max-height: calc\(100vh - 20px\) !important;/);
  assert.match(css, /html\[data-window-mode='quick'\] \.onboarding-card \{[\s\S]*min-height: 0 !important;[\s\S]*max-height: calc\(100vh - 20px\) !important;[\s\S]*overflow-y: auto !important;/);
  assert.match(css, /html\[data-window-mode='quick'\] body::before,[\s\S]*content: none !important;/);
});

test('full app keeps scrolling while hiding its scrollbar', async () => {
  const css = await read('src/glass-overrides.css');
  assert.match(css, /\.full-content \{[\s\S]*scrollbar-width: none;[\s\S]*-ms-overflow-style: none/);
  assert.match(css, /\.full-content::\-webkit-scrollbar \{ width: 0; height: 0; display: none; \}/);
});
