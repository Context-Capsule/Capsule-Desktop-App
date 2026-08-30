import { access, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

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

await mkdir(dirname(destination), { recursive: true });
for (const candidate of candidates) {
  if (await exists(candidate)) {
    await copyFile(candidate, destination);
    console.log(`Prepared Context Capsule brand asset from ${candidate}`);
    process.exit(0);
  }
}

// A clean checkout may not have the Browser Extension beside it. If GitHub CLI
// is authenticated, fetch the exact canonical extension asset without adding a
// runtime network dependency to the application itself.
const gh = spawnSync(
  'gh',
  [
    'api',
    'repos/Context-Capsule/Capsule-Browser-Extension/contents/src/popup/capsule-bgless.png',
    '-H',
    'Accept: application/vnd.github.raw+json'
  ],
  { encoding: 'buffer', windowsHide: true, maxBuffer: 4 * 1024 * 1024 }
);
if (gh.status === 0 && gh.stdout?.length) {
  await writeFile(destination, gh.stdout);
  console.log('Prepared Context Capsule brand asset from Capsule-Browser-Extension via GitHub CLI.');
  process.exit(0);
}

if (await exists(destination)) {
  console.log(`Using existing Context Capsule brand asset at ${destination}`);
  process.exit(0);
}

throw new Error(
  'Could not prepare the Context Capsule logo. Keep Capsule-Browser-Extension beside this repo, ' +
  'set CAPSULE_BRAND_ASSET to src/popup/capsule-bgless.png, or authenticate GitHub CLI with access to the extension repo.'
);
