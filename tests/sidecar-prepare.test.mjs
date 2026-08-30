import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const names = ['capsule', 'capsule-agent-worker', 'capsule-firefox-host', 'capsule-chrome-host'];
const triple = 'x86_64-context-capsule-test';
const exe = process.platform === 'win32' ? '.exe' : '';

test('sidecar preparation copies all required binaries byte-for-byte', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'context-capsule-sidecars-'));
  const outputs = names.map((name) => resolve(root, 'src-tauri', 'binaries', `${name}-${triple}${exe}`));
  try {
    for (const name of names) await writeFile(join(dir, `${name}${exe}`), `binary:${name}\n`);
    const result = spawnSync(process.execPath, ['scripts/prepare-sidecar.mjs'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, CAPSULE_CLI_BIN: join(dir, `capsule${exe}`), CAPSULE_TARGET_TRIPLE: triple }
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    for (const [index, name] of names.entries()) {
      assert.equal(await readFile(outputs[index], 'utf8'), `binary:${name}\n`);
    }
  } finally {
    await Promise.all(outputs.map((path) => unlink(path).catch(() => undefined)));
    await rm(dir, { recursive: true, force: true });
  }
});

test('sidecar preparation refuses a partial CLI build', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'context-capsule-sidecars-incomplete-'));
  try {
    await writeFile(join(dir, `capsule${exe}`), 'only-capsule');
    const result = spawnSync(process.execPath, ['scripts/prepare-sidecar.mjs'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, CAPSULE_CLI_BIN: join(dir, `capsule${exe}`), CAPSULE_TARGET_TRIPLE: triple }
    });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}\n${result.stdout}`, /Required release binary is missing/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
