import { cp, access, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const binariesDir = join(root, 'src-tauri', 'binaries');
const isWindows = process.platform === 'win32';
const exe = isWindows ? '.exe' : '';
const desktopApiVersion = 1;
const names = ['capsule', 'capsule-agent-worker', 'capsule-firefox-host', 'capsule-chrome-host'];

function hostTriple() {
  if (process.env.TAURI_ENV_TARGET_TRIPLE) return process.env.TAURI_ENV_TARGET_TRIPLE;
  if (process.env.CAPSULE_TARGET_TRIPLE) return process.env.CAPSULE_TARGET_TRIPLE;
  try {
    return execFileSync('rustc', ['--print', 'host-tuple'], { encoding: 'utf8' }).trim();
  } catch {
    try {
      const verbose = execFileSync('rustc', ['-Vv'], { encoding: 'utf8' });
      const match = verbose.match(/^host:\s*(.+)$/m);
      if (match) return match[1].trim();
    } catch { /* handled below */ }
  }
  if (process.platform === 'win32' && process.arch === 'x64') return 'x86_64-pc-windows-msvc';
  throw new Error('Could not determine Rust target triple. Set CAPSULE_TARGET_TRIPLE explicitly.');
}

async function exists(path) {
  try { await access(path, constants.R_OK); return true; } catch { return false; }
}

function rebuildSiblingCli(cliRoot) {
  if (process.env.CAPSULE_CLI_AUTO_BUILD === '0') return;
  const manifest = join(cliRoot, 'Cargo.toml');
  console.log('Building the paired Capsule CLI release binaries so the desktop app cannot reuse a stale runtime...');
  execFileSync('cargo', ['build', '--release', '--bins', '--manifest-path', manifest], {
    cwd: cliRoot,
    stdio: 'inherit'
  });
}

async function resolveCliDir() {
  const explicit = process.env.CAPSULE_CLI_BIN;
  if (explicit) {
    const absolute = resolve(explicit);
    if (!(await exists(absolute))) throw new Error(`CAPSULE_CLI_BIN does not exist: ${absolute}`);
    return dirname(absolute);
  }

  const siblingCli = resolve(root, '..', 'Capsule-CLI');
  if (await exists(join(siblingCli, 'Cargo.toml'))) rebuildSiblingCli(siblingCli);

  const candidates = [
    resolve(siblingCli, 'target', 'release'),
    resolve(siblingCli, 'target', 'debug')
  ];
  for (const candidate of candidates) {
    if (await exists(join(candidate, `capsule${exe}`))) return candidate;
  }
  throw new Error(
    'Context Capsule CLI build not found. Build Capsule-CLI first with `cargo build --release --bins`, ' +
    'or set CAPSULE_CLI_BIN to the built capsule executable.'
  );
}

function verifyDesktopApi(cliDir) {
  if (process.env.CAPSULE_TEST_SKIP_API_PREFLIGHT === '1') return;
  const capsule = join(cliDir, `capsule${exe}`);
  const result = spawnSync(capsule, ['desktop', 'contract'], {
    cwd: cliDir,
    encoding: 'utf8',
    windowsHide: true
  });
  const stderr = (result.stderr ?? '').trim();
  const stdout = (result.stdout ?? '').trim();
  const repair = 'Switch Capsule-CLI to `feature/desktop-app-api-20260830`, run `cargo build --release --bins`, then start the desktop app again.';

  if (result.error) {
    throw new Error(`Capsule CLI desktop API preflight could not start ${capsule}: ${result.error.message}. ${repair}`);
  }
  if (result.status !== 0) {
    throw new Error(`Capsule CLI desktop API preflight failed (exit ${result.status}). ${stderr || stdout || 'No diagnostic output.'} ${repair}`);
  }
  if (!stdout) {
    throw new Error(`Capsule CLI desktop API preflight returned no JSON. ${stderr ? `stderr: ${stderr}. ` : ''}${repair}`);
  }

  let envelope;
  try { envelope = JSON.parse(stdout); }
  catch (error) {
    throw new Error(`Capsule CLI desktop API preflight returned invalid JSON: ${error.message}. ${repair}`);
  }
  if (envelope?.api_version !== desktopApiVersion || envelope?.ok !== true) {
    throw new Error(`Capsule CLI desktop API v${desktopApiVersion} is required. ${repair}`);
  }
  console.log(`Verified Capsule desktop API v${desktopApiVersion}.`);
}

const triple = hostTriple();
const cliDir = await resolveCliDir();
for (const name of names) {
  const source = join(cliDir, `${name}${exe}`);
  if (!(await exists(source))) {
    throw new Error(`Required release binary is missing: ${source}. Run \`cargo build --release --bins\`.`);
  }
}
verifyDesktopApi(cliDir);
await mkdir(binariesDir, { recursive: true });

for (const name of names) {
  const source = join(cliDir, `${name}${exe}`);
  const destination = join(binariesDir, `${name}-${triple}${exe}`);
  await cp(source, destination);
  console.log(`Prepared ${name}: ${destination}`);
}
