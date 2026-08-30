import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFile(resolve(root, path), 'utf8');

test('save advanced discovery is eager, bounded, retryable, and never exposes executable paths', async () => {
  const source = await read('src/components/SaveModal.svelte');
  assert.match(source, /APPLICATION_DISCOVERY_TIMEOUT_MS\s*=\s*6500/);
  assert.match(source, /Promise\.race/);
  assert.match(source, /onMount\(\(\) => \{[\s\S]*void loadApplications\(\)/);
  assert.match(source, /loadApplications\(true\)/);
  assert.match(source, /Application discovery timed out/);
  assert.doesNotMatch(source, /<small>\{app\.executable_path\}<\/small>/);
});

test('save dialog handles disconnected Zen before the CLI preflight and offers a real host repair', async () => {
  const source = await read('src/components/SaveModal.svelte');
  assert.match(source, /zenApp = applications\.find\(isZenApplication\)/);
  assert.match(source, /firefoxFresh = Boolean\(live\?\.browsers\?\.firefox\)/);
  assert.match(source, /runOperation\(\{ kind: 'install-browser-host', browser: 'firefox' \}\)/);
  assert.match(source, /if \(browserStateKnown && zenApp && !firefoxFresh && !zenIgnored\)/);
  assert.match(source, /Repair connection/);
  assert.match(source, /explicitly ignore Zen/);
  assert.match(source, /internalSelector \? \[internalSelector\]/);
});

test('save operation output is deduplicated and preloaded self exclusion avoids another live scan', async () => {
  const source = await read('src/App.svelte');
  assert.match(source, /function appendUniqueOperationLines/);
  assert.match(source, /!next\.includes\(clean\)/);
  assert.match(source, /stderr was already streamed through operation-progress/);
  assert.match(source, /if \(request\.ignoreApps\.some\(isInternalSelector\)\) return request/);
});

test('quick window remains rectangular-backdrop-free in modal and operation states', async () => {
  const css = await read('src/glass-overrides.css');
  assert.match(css, /html\[data-window-mode='quick'\] \.modal-backdrop,[\s\S]*html\[data-window-mode='quick'\] \.operation-overlay[\s\S]*background: transparent !important;[\s\S]*backdrop-filter: none !important/);
  assert.match(css, /quick-panel[\s\S]*rgba\(11,14,9,\.58\)[\s\S]*rgba\(5,7,5,\.66\)/);
  assert.match(css, /html\[data-window-mode='quick'\] \.operation-card \{ background: rgba\(7,9,6,\.94\) !important; \}/);
});

test('full app keeps scrolling while hiding its scrollbar', async () => {
  const css = await read('src/glass-overrides.css');
  assert.match(css, /\.full-content \{[\s\S]*scrollbar-width: none;[\s\S]*-ms-overflow-style: none/);
  assert.match(css, /\.full-content::\-webkit-scrollbar \{ width: 0; height: 0; display: none; \}/);
});
