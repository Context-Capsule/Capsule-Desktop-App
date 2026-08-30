import { access, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const destination = resolve(root, 'public', 'context-capsule-logo.png');
const explicit = process.env.CAPSULE_BRAND_ASSET ? resolve(process.env.CAPSULE_BRAND_ASSET) : null;
const candidates = [
  explicit,
  resolve(root, '..', 'Capsule-Browser-Extension', 'src', 'popup', 'capsule-bgless.png')
].filter(Boolean);

async function exists(path) {
  try { await access(path, constants.R_OK); return true; } catch { return false; }
}

async function installBrandAsset() {
  await mkdir(dirname(destination), { recursive: true });
  for (const candidate of candidates) {
    if (await exists(candidate)) {
      await copyFile(candidate, destination);
      console.log(`Prepared Context Capsule brand asset from ${candidate}`);
      return;
    }
  }

  // A clean checkout may not have the Browser Extension beside it. If GitHub
  // CLI is authenticated, fetch the exact canonical extension asset. The app
  // itself never needs network access for branding.
  const gh = spawnSync(
    'gh',
    [
      'api',
      'repos/Context-Capsule/Capsule-Browser-Extension/contents/src/popup/capsule-bgless.png',
      '-H',
      'Accept: application/vnd.github.raw+json'
    ],
    { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }
  );
  if (gh.status === 0 && gh.stdout?.length) {
    await writeFile(destination, gh.stdout);
    console.log('Prepared Context Capsule brand asset from Capsule-Browser-Extension via GitHub CLI.');
    return;
  }

  if (await exists(destination)) {
    console.log(`Using existing Context Capsule brand asset at ${destination}`);
    return;
  }

  throw new Error(
    'The canonical Context Capsule logo is required. Place Capsule-Browser-Extension beside this repo, ' +
    'set CAPSULE_BRAND_ASSET, or authenticate GitHub CLI before starting the desktop app.'
  );
}

await installBrandAsset();

// The in-app artwork and the native executable/window/tray icons must come from
// the exact same canonical PNG. Invoke the locally installed Tauri JS entrypoint
// through the current Node executable rather than npx.cmd: modern Node on Windows
// does not reliably spawn .cmd shims directly, especially from paths containing
// spaces. Passing the paths as argv also avoids shell quoting issues.
const tauriCli = resolve(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
if (!(await exists(tauriCli))) {
  throw new Error('The local Tauri CLI is missing. Run npm install before preparing Context Capsule branding.');
}
const icons = spawnSync(process.execPath, [tauriCli, 'icon', destination], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true
});
if (icons.error) {
  throw new Error(`Could not start the Tauri icon generator: ${icons.error.message}`);
}
if (icons.status !== 0) {
  throw new Error(`Could not regenerate native Context Capsule icons from the canonical Browser Extension logo (exit code ${icons.status ?? 'unknown'}).`);
}
console.log('Regenerated native executable, window and tray icons from the canonical Context Capsule logo.');
