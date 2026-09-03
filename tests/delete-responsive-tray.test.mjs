import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFile(resolve(root, path), 'utf8');

test('operations finish on direct child termination instead of waiting for pipe EOF', async () => {
  const source = await read('src-tauri/src/lib.rs');
  const start = source.indexOf('async fn run_operation');
  const end = source.indexOf('async fn cancel_operation', start);
  const implementation = source.slice(start, end);
  assert.match(implementation, /CommandEvent::Terminated\(payload\)/);
  assert.match(implementation, /operation\.terminated/);
  assert.match(implementation, /operation_started\.elapsed\(\)\.as_millis\(\)/);
  const terminated = implementation.slice(implementation.indexOf('CommandEvent::Terminated'));
  assert.match(terminated.slice(0, terminated.indexOf('_ => {}')), /break;/);
});

test('delete stays on the narrow capsule sidecar path without live discovery', async () => {
  const source = await read('src-tauri/src/lib.rs');
  const commandStart = source.indexOf('fn operation_command');
  const commandEnd = source.indexOf('async fn preferred_operation_directory', commandStart);
  const command = source.slice(commandStart, commandEnd);
  assert.match(command, /OperationRequest::Delete \{ name \}[\s\S]*"delete"\.to_owned\(\)[\s\S]*"capsule"/);

  const cwdStart = source.indexOf('async fn preferred_operation_directory');
  const cwdEnd = source.indexOf('fn existing_local_directory', cwdStart);
  const cwd = source.slice(cwdStart, cwdEnd);
  assert.match(cwd, /OperationRequest::Save[\s\S]*OperationRequest::Update/);
  assert.doesNotMatch(cwd, /OperationRequest::Delete/);
});

test('main sidebar has a reachable compact rail and breakpoint-aware manual toggle', async () => {
  const controller = await read('src/lib/responsive-sidebar.ts');
  const css = await read('src/responsive-sidebar.css');
  const main = await read('src/main.ts');
  const config = JSON.parse(await read('src-tauri/tauri.conf.json'));
  const mainWindow = config.app.windows.find((window) => window.label === 'main');

  assert.match(controller, /SIDEBAR_BREAKPOINT = 820/);
  assert.match(controller, /expanded = !nextNarrow/);
  assert.match(controller, /if \(nextNarrow === narrow\) return/);
  assert.match(controller, /expanded = !expanded/);
  assert.match(controller, /aria-label/);
  assert.match(css, /sidebar-collapsed/);
  assert.match(css, /grid-template-columns: 64px minmax\(0, 1fr\)/);
  assert.match(main, /installResponsiveSidebar\(\)/);
  assert.ok(mainWindow.minWidth < 820);
});

test('quick WebView backing surface is explicitly alpha-zero', async () => {
  const config = JSON.parse(await read('src-tauri/tauri.conf.json'));
  const quick = config.app.windows.find((window) => window.label === 'quick');
  assert.equal(quick.transparent, true);
  assert.equal(quick.backgroundColor, '#00000000');
  assert.equal(quick.shadow, false);
  assert.equal(quick.windowEffects, undefined);
});
