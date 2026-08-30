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
  resolve(root, '..', 'Capsule-Browser-Extension', 'src', 'popup', 'capsule-bgless.png'),
  resolve(root, '..', 'Capsule-Firefox-Extension', 'src', 'popup', 'capsule-bgless.png')
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
      return true;
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
    return true;
  }

  if (await exists(destination)) {
    console.log(`Using existing Context Capsule brand asset at ${destination}`);
    return true;
  }

  console.warn(
    'Context Capsule Browser Extension logo was not available; keeping the checked-in desktop icon fallback. ' +
    'Place Capsule-Browser-Extension beside this repo or set CAPSULE_BRAND_ASSET to use the canonical logo.'
  );
  return false;
}

if (await installBrandAsset()) {
  // icons:generate runs first and guarantees a safe fallback. When the exact
  // Browser Extension artwork is available, replace those generated native
  // icons as a best-effort enhancement without making startup depend on it.
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const icons = spawnSync(npx, ['tauri', 'icon', destination], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true
  });
  if (icons.status !== 0) {
    console.warn('Could not regenerate native icons from the Browser Extension logo; the safe fallback icons remain in place.');
  }
}
