import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFile(resolve(root, path), 'utf8');

test('save overlay exposes cancellation while save is still running', async () => {
  const app = await read('src/App.svelte');
  const overlay = await read('src/components/OperationOverlay.svelte');
  const bridge = await read('src/lib/bridge.ts');
  assert.match(app, /operationCancelable = request\.kind === 'save'/);
  assert.match(app, /cancelOperation\(operationId\)/);
  assert.match(overlay, /Cancel save/);
  assert.match(bridge, /invoke<void>\('cancel_operation'/);
});

test('glass wrapper clips every painted surface to the same radius', async () => {
  const glass = await read('src/components/Glass.svelte');
  const overrides = await read('src/glass-overrides.css');
  assert.match(glass, /border-radius:\$\{radius\}px/);
  assert.match(overrides, /liquid-glass\.glass > \*/);
  assert.match(overrides, /border:\s*0\s*!important/);
});
