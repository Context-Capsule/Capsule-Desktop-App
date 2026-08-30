import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFile(resolve(root, path), 'utf8');

test('desktop bundle contains the complete Context Capsule runtime', async () => {
  const config = JSON.parse(await read('src-tauri/tauri.conf.json'));
  assert.deepEqual(config.bundle.externalBin, [
    'binaries/capsule',
    'binaries/capsule-agent-worker',
    'binaries/capsule-firefox-host',
    'binaries/capsule-chrome-host'
  ]);
});

test('webview has no arbitrary shell permission or JS shell dependency', async () => {
  const capabilities = JSON.parse(await read('src-tauri/capabilities/default.json'));
  const packageJson = JSON.parse(await read('package.json'));
  assert.equal(packageJson.dependencies?.['@tauri-apps/plugin-shell'], undefined);
  assert.equal(capabilities.permissions.some((permission) => String(permission).includes('shell')), false);
});

test('Rust backend restricts desktop reads and operations', async () => {
  const source = await read('src-tauri/src/lib.rs');
  for (const readAction of ['contract', 'overview', 'live', 'health', 'log-paths', 'capsule', 'history', 'services', 'diff']) {
    assert.match(source, new RegExp(`"${readAction.replace('-', '\\-')}"`));
  }
  for (const kind of ['Save', 'Update', 'Restore', 'Delete', 'Note', 'ServicePolicy', 'ServicePrestart', 'InstallBrowserHost']) {
    assert.match(source, new RegExp(`OperationRequest::${kind}`));
  }
  assert.match(source, /only Context Capsule log files can be opened/);
});

test('GUI restore uses worker decision-file contract instead of fake interactive stdin', async () => {
  const source = await read('src-tauri/src/lib.rs');
  assert.match(source, /"capsule-agent-worker"/);
  assert.match(source, /CONTEXT_CAPSULE_SERVICE_DECISIONS_PATH/);
  assert.match(source, /"start-once"/);
  assert.match(source, /"always"/);
  assert.match(source, /"skip"/);
  assert.doesNotMatch(source, /child\.write\(/);
});

test('GUI update reuses the proven service-safe force-save path', async () => {
  const source = await read('src-tauri/src/lib.rs');
  const updateStart = source.indexOf('OperationRequest::Update');
  const restoreStart = source.indexOf('OperationRequest::Restore', updateStart);
  const update = source.slice(updateStart, restoreStart);
  assert.match(update, /"save"/);
  assert.match(update, /"--force"/);
  assert.match(update, /"--cli-force"/);
  assert.match(update, /"--ignore-app"/);
});

test('save and update select a trusted project working directory', async () => {
  const source = await read('src-tauri/src/lib.rs');
  assert.match(source, /preferred_operation_directory/);
  assert.match(source, /foreground_command/);
  assert.match(source, /workspaceFolders/);
  assert.match(source, /path\.is_dir\(\)/);
  assert.match(source, /current_dir\(path\)/);
});

test('autostart is tray-only while explicit launch opens the app', async () => {
  const source = await read('src-tauri/src/lib.rs');
  assert.match(source, /Some\(vec!\["--autostart"\]\)/);
  assert.match(source, /if !autostart/);
  assert.match(source, /show_main_window/);
  const packageJson = JSON.parse(await read('package.json'));
  assert.ok(packageJson.dependencies['@tauri-apps/plugin-autostart']);
});


test('application icons are generated from one checked-in SVG source', async () => {
  const packageJson = JSON.parse(await read('package.json'));
  const gitignore = await read('.gitignore');
  const svg = await read('src-tauri/icons/icon.svg');
  assert.equal(packageJson.scripts['icons:generate'], 'tauri icon src-tauri/icons/icon.svg');
  assert.match(packageJson.scripts['tauri:dev'], /icons:generate/);
  assert.match(packageJson.scripts['tauri:build'], /icons:generate/);
  assert.match(svg, /#eaff36/i);
  assert.match(gitignore, /src-tauri\/icons\/icon\.ico/);
});

test('visual system uses an existing liquid-glass implementation', async () => {
  const packageJson = JSON.parse(await read('package.json'));
  const main = await read('src/main.ts');
  const glass = await read('src/components/Glass.svelte');
  assert.ok(packageJson.dependencies['simple-liquid-glass']);
  assert.match(main, /simple-liquid-glass\/web-component/);
  assert.match(glass, /<liquid-glass/);
});

test('desktop keeps diagnostic logging and bounded rotation', async () => {
  const source = await read('src-tauri/src/lib.rs');
  assert.match(source, /MAX_LOG_BYTES: u64 = 1024 \* 1024/);
  assert.match(source, /desktop-app\.log/);
  assert.match(source, /desktop-app\.log\.1/);
  assert.match(source, /operation\.begin/);
  assert.match(source, /operation\.complete/);
  assert.match(source, /operation\.cwd/);
});

test('renamed Browser Extension repository is the documented integration source', async () => {
  const readme = await read('README.md');
  assert.match(readme, /Context-Capsule\/Capsule-Browser-Extension/);
  assert.doesNotMatch(readme, /Capsule-Firefox-Extension/);
});
