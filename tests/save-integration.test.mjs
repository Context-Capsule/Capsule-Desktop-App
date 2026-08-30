import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFile(resolve(root, path), 'utf8');

test('save advanced discovery uses the previously working lazy flow without an artificial timeout', async () => {
  const source = await read('src/components/SaveModal.svelte');
  assert.doesNotMatch(source, /APPLICATION_DISCOVERY_TIMEOUT_MS/);
  assert.doesNotMatch(source, /Promise\.race/);
  assert.doesNotMatch(source, /Application discovery timed out/);
  assert.doesNotMatch(source, /onMount\([\s\S]*loadApplications/);
  assert.match(source, /function toggleAdvanced\(\)[\s\S]*if \(advanced && !loadingApps && !detectedApps\.length\) void loadApplications\(\)/);
  assert.match(source, /loadApplications\(true\)/);
  assert.doesNotMatch(source, /<small>\{app\.executable_path\}<\/small>/);
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

test('save paints progress before any live-workspace exclusion await so the tray never flashes home', async () => {
  const source = await read('src/App.svelte');
  const executeStart = source.indexOf('async function execute(request: OperationRequest)');
  const visible = source.indexOf('operationVisible = true;', executeStart);
  const exclusionAwait = source.indexOf('await withInternalExclusions(request)', executeStart);
  assert.ok(executeStart >= 0, 'execute function missing');
  assert.ok(visible > executeStart, 'operation overlay is not made visible');
  assert.ok(exclusionAwait > visible, 'live exclusion discovery still runs before progress is visible');
  assert.match(source, /function appendUniqueOperationLines/);
  assert.match(source, /!next\.includes\(clean\)/);
  assert.match(source, /stderr was already streamed through operation-progress/);
  assert.match(source, /if \(request\.ignoreApps\.some\(isInternalSelector\)\) return request/);
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

test('full app keeps scrolling while hiding its scrollbar', async () => {
  const css = await read('src/glass-overrides.css');
  assert.match(css, /\.full-content \{[\s\S]*scrollbar-width: none;[\s\S]*-ms-overflow-style: none/);
  assert.match(css, /\.full-content::\-webkit-scrollbar \{ width: 0; height: 0; display: none; \}/);
});
