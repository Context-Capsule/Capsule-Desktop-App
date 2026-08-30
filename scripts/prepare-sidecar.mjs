import { cp, access, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const binariesDir = join(root, 'src-tauri', 'binaries');
const isWindows = process.platform === 'win32';
const exe = isWindows ? '.exe' : '';

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

async function resolveCliDir() {
  const explicit = process.env.CAPSULE_CLI_BIN;
  if (explicit) {
    const absolute = resolve(explicit);
    if (!(await exists(absolute))) throw new Error(`CAPSULE_CLI_BIN does not exist: ${absolute}`);
    return dirname(absolute);
  }

  const candidates = [
    resolve(root, '..', 'Capsule-CLI', 'target', 'release'),
    resolve(root, '..', 'Capsule-CLI', 'target', 'debug')
  ];
  for (const candidate of candidates) {
    if (await exists(join(candidate, `capsule${exe}`))) return candidate;
  }
  throw new Error(
    'Context Capsule CLI build not found. Build Capsule-CLI first with `cargo build --release --bins`, ' +
    'or set CAPSULE_CLI_BIN to the built capsule executable.'
  );
}

const triple = hostTriple();
const cliDir = await resolveCliDir();
const names = ['capsule', 'capsule-agent-worker', 'capsule-firefox-host', 'capsule-chrome-host'];
await mkdir(binariesDir, { recursive: true });

for (const name of names) {
  const source = join(cliDir, `${name}${exe}`);
  if (!(await exists(source))) {
    throw new Error(`Required release binary is missing: ${source}. Run \`cargo build --release --bins\`.`);
  }
  const destination = join(binariesDir, `${name}-${triple}${exe}`);
  await cp(source, destination);
  console.log(`Prepared ${name}: ${destination}`);
}
