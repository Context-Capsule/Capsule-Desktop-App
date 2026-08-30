import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFile(resolve(root, path), 'utf8');

test('save advanced discovery uses the proven live workspace API without an artificial timeout', async () => {
  const source = await read('src/components/SaveModal.svelte');
  const bridge = await read('src/lib/bridge.ts');
  const rust = await read('src-tauri/src/lib.rs');
  assert.doesNotMatch(source, /APPLICATION_DISCOVERY_TIMEOUT_MS/);
  assert.doesNotMatch(source, /Promise\.race/);
  assert.doesNotMatch(source, /Application discovery timed out/);
  assert.doesNotMatch(source, /onMount\([\s\S]*loadApplications/);
  assert.match(source, /getLiveWorkspace/);
  assert.doesNotMatch(source, /getApplications/);
  assert.match(source, /const live = await getLiveWorkspace\(\)/);
  assert.match(source, /function toggleAdvanced\(\)[\s\S]*if \(advanced && !loadingApps && !detectedApps\.length\) void loadApplications\(\)/);
  assert.match(source, /loadApplications\(true\)/);
  assert.doesNotMatch(source, /<small>\{app\.executable_path\}<\/small>/);
  assert.match(bridge, /getLiveWorkspace = \(\) => queryDesktop<any>\('live'\)/);
  assert.match(rust, /"live"/);
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

test('save paints progress before self-exclusion discovery and keeps the proven live fallback', async () => {
  const source = await read('src/App.svelte');
  const executeStart = source.indexOf('async function execute(request: OperationRequest)');
  const visible = source.indexOf('operationVisible = true;', executeStart);
  const exclusionAwait = source.indexOf('await withInternalExclusions(request)', executeStart);
  assert.ok(executeStart >= 0, 'execute function missing');
  assert.ok(visible > executeStart, 'operation overlay is not made visible');
  assert.ok(exclusionAwait > visible, 'self-exclusion discovery still runs before progress is visible');
  assert.match(source, /const live = await getLiveWorkspace\(\)/);
  assert.match(source, /getLiveWorkspace/);
  assert.doesNotMatch(source, /getApplications/);
  assert.match(source, /function appendUniqueOperationLines/);
  assert.match(source, /!next\.includes\(clean\)/);
  assert.match(source, /stderr was already streamed through operation-progress/);
  assert.match(source, /if \(request\.ignoreApps\.some\(isInternalSelector\)\) return request/);
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