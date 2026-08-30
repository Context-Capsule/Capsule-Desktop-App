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

test('GUI save and update reuse the mature worker while excluding their launcher terminal', async () => {
  const source = await read('src-tauri/src/lib.rs');
  assert.match(source, /const CALLER_PID_ENV: &str = "CONTEXT_CAPSULE_CALLER_PID"/);
  assert.match(source, /command = command\.env\(CALLER_PID_ENV, std::process::id\(\)\.to_string\(\)\)/);
  const saveImplementation = source.slice(source.indexOf('fn operation_command'), source.indexOf('async fn preferred_operation_directory'));
  assert.match(saveImplementation, /OperationRequest::Save[\s\S]*"--cli-force"[\s\S]*"capsule-agent-worker"/);
  assert.match(saveImplementation, /OperationRequest::Update[\s\S]*"--force"[\s\S]*"--cli-force"[\s\S]*"capsule-agent-worker"/);
});

test('save cancellation owns the child process and only cleans up newly-created capsules', async () => {
  const source = await read('src-tauri/src/lib.rs');
  assert.match(source, /struct ActiveOperation/);
  assert.match(source, /child: CommandChild/);
  assert.match(source, /async fn cancel_operation/);
  assert.match(source, /operation\.child\s*\.kill\(\)/);
  assert.match(source, /filter\(\|_\| !operation\.save_existed\)/);
  assert.match(source, /sidecar\("capsule-agent-worker"\)/);
  assert.match(source, /args\(\["delete", &name\]\)/);
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

test('desktop branding uses only the Browser Extension artwork when available', async () => {
  const packageJson = JSON.parse(await read('package.json'));
  const gitignore = await read('.gitignore');
  const svg = await read('src-tauri/icons/icon.svg');
  const branding = await read('scripts/prepare-branding.mjs');
  const overrides = await read('src/glass-overrides.css');
  assert.equal(packageJson.scripts['icons:generate'], 'tauri icon src-tauri/icons/icon.svg');
  assert.match(packageJson.scripts['tauri:dev'], /icons:generate/);
  assert.match(packageJson.scripts['tauri:dev'], /brand:prepare/);
  assert.match(packageJson.scripts['tauri:build'], /icons:generate/);
  assert.match(packageJson.scripts['tauri:build'], /brand:prepare/);
  assert.match(branding, /Capsule-Browser-Extension/);
  assert.match(branding, /src.+popup.+capsule-bgless\.png/s);
  assert.match(branding, /keeping the checked-in desktop icon fallback/);
  assert.match(overrides, /context-capsule-logo\.png/);
  assert.match(overrides, /brand-mark > svg \{ display: none !important; \}/);
  assert.match(svg, /#eaff36/i);
  assert.match(gitignore, /src-tauri\/icons\/icon\.ico/);
});

test('quick panel is smaller and Windows surfaces use stronger acrylic transparency', async () => {
  const config = JSON.parse(await read('src-tauri/tauri.conf.json'));
  const quick = config.app.windows.find((window) => window.label === 'quick');
  const main = config.app.windows.find((window) => window.label === 'main');
  const overrides = await read('src/glass-overrides.css');
  assert.equal(quick.width, 340);
  assert.equal(quick.height, 440);
  assert.equal(quick.transparent, true);
  assert.ok(quick.windowEffects.effects.includes('acrylic'));
  assert.equal(main.transparent, true);
  assert.ok(main.windowEffects.effects.includes('acrylic'));
  assert.match(overrides, /rgba\(17,21,13,\.43\)/);
  assert.match(overrides, /liquid-glass\.glass \{[\s\S]*border: 0 !important/);
  assert.match(overrides, /liquid-glass\.glass > \* \{ border-radius: inherit; \}/);
  assert.doesNotMatch(overrides, /linear-gradient\([^;]*#060706/);
});

test('live application list hides executable paths and process metadata', async () => {
  const overrides = await read('src/glass-overrides.css');
  assert.match(overrides, /live-summary \+ liquid-glass\.table-card[\s\S]*display: none/);
});

test('sidecar preparation validates the desktop API before copying runtime binaries', async () => {
  const source = await read('scripts/prepare-sidecar.mjs');
  assert.match(source, /\['desktop', 'contract'\]/);
  assert.match(source, /desktopApiVersion = 1/);
  assert.match(source, /cargo', \['build', '--release', '--bins'/);
  assert.match(source, /CAPSULE_TEST_SKIP_API_PREFLIGHT/);
});

test('visual system uses an existing liquid-glass implementation', async () => {
  const packageJson = JSON.parse(await read('package.json'));
  const main = await read('src/main.ts');
  const glass = await read('src/components/Glass.svelte');
  assert.ok(packageJson.dependencies['simple-liquid-glass']);
  assert.match(main, /simple-liquid-glass\/web-component/);
  assert.match(main, /glass-overrides\.css/);
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
  assert.match(source, /operation\.cancel/);
});

test('renamed Browser Extension repository is the documented integration source', async () => {
  const readme = await read('README.md');
  assert.match(readme, /Context-Capsule\/Capsule-Browser-Extension/);
  assert.doesNotMatch(readme, /Capsule-Firefox-Extension/);
});
