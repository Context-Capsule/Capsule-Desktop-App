import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const width = 340;
const height = 440;
const states = [
  ['save-loaded', '.modal-shell'],
  ['save-error', '.modal-shell'],
  ['restore-tall', '.modal-shell'],
  ['onboarding', '.onboarding-shell'],
  ['operation-error', '.operation-shell']
];

function findEdge() {
  const candidates = [
    process.env.EDGE_PATH,
    process.env['ProgramFiles(x86)'] && join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.ProgramFiles && join(process.env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate));
}

async function reservePort() {
  return await new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
}

async function waitForJson(url, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`Edge DevTools endpoint did not become ready: ${lastError ?? 'timeout'}`);
}

class CdpClient {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.events = new Map();
    this.socket = new WebSocket(url);
  }

  async open() {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await new Promise((resolveOpen, reject) => {
      this.socket.addEventListener('open', resolveOpen, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const waiter = this.pending.get(message.id);
        if (!waiter) return;
        this.pending.delete(message.id);
        if (message.error) waiter.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
        else waiter.resolve(message.result ?? {});
        return;
      }
      const waiters = this.events.get(message.method);
      if (!waiters?.length) return;
      this.events.delete(message.method);
      for (const waiter of waiters) waiter(message.params ?? {});
    });
  }

  call(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolveCall, reject) => {
      this.pending.set(id, { resolve: resolveCall, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  waitEvent(method, timeoutMs = 10_000) {
    return new Promise((resolveEvent, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeoutMs);
      const resolver = (params) => { clearTimeout(timer); resolveEvent(params); };
      this.events.set(method, [...(this.events.get(method) ?? []), resolver]);
    });
  }

  close() { this.socket.close(); }
}

function assertViewportLayout(state, metrics) {
  const epsilon = 0.75;
  if (metrics.innerWidth !== width || metrics.innerHeight !== height) {
    throw new Error(`${state}: expected ${width}x${height} CSS viewport, got ${metrics.innerWidth}x${metrics.innerHeight}`);
  }
  if (!metrics.shell) throw new Error(`${state}: visual shell was not found`);
  if (metrics.shell.left < -epsilon || metrics.shell.right > width + epsilon) {
    throw new Error(`${state}: shell escapes viewport horizontally: ${JSON.stringify(metrics.shell)}`);
  }
  if (metrics.shell.width > width + epsilon) {
    throw new Error(`${state}: shell is wider than viewport: ${metrics.shell.width}px`);
  }
  if (metrics.rootScrollWidth > width + 1 || metrics.bodyScrollWidth > width + 1) {
    throw new Error(`${state}: document has horizontal overflow (root=${metrics.rootScrollWidth}, body=${metrics.bodyScrollWidth})`);
  }
}

const edge = findEdge();
if (!edge) throw new Error('Microsoft Edge is unavailable for quick-window visual validation.');
if (typeof WebSocket === 'undefined') throw new Error('Node.js WebSocket support is required for visual validation.');

const outputDir = join(root, 'screenshots', 'quick');
await mkdir(outputDir, { recursive: true });
const fixture = pathToFileURL(join(root, 'tests', 'visual', 'quick-states.html')).href;
const port = await reservePort();
const profile = join(process.env.RUNNER_TEMP ?? os.tmpdir(), `context-capsule-edge-cdp-${process.pid}`);
await rm(profile, { recursive: true, force: true });

const edgeProcess = spawn(edge, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  'about:blank'
], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
let edgeStderr = '';
edgeProcess.stderr.on('data', (chunk) => { edgeStderr += String(chunk).slice(-16_000); });

try {
  const targets = await waitForJson(`http://127.0.0.1:${port}/json`);
  const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
  if (!page) throw new Error('Edge did not expose a page DevTools target.');

  const cdp = new CdpClient(page.webSocketDebuggerUrl);
  await cdp.open();
  try {
    await cdp.call('Page.enable');
    await cdp.call('Runtime.enable');
    await cdp.call('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: width,
      screenHeight: height,
      positionX: 0,
      positionY: 0,
      dontSetVisibleSize: false
    });

    for (const [state, selector] of states) {
      const loaded = cdp.waitEvent('Page.loadEventFired');
      await cdp.call('Page.navigate', { url: `${fixture}?state=${encodeURIComponent(state)}` });
      await loaded;

      const evaluated = await cdp.call('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => {
          const shell = document.querySelector(${JSON.stringify(selector)});
          const rect = shell?.getBoundingClientRect();
          return {
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
            rootScrollWidth: document.documentElement.scrollWidth,
            bodyScrollWidth: document.body.scrollWidth,
            shell: rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height } : null
          };
        })()`
      });
      const metrics = evaluated.result?.value;
      assertViewportLayout(state, metrics);

      const screenshot = await cdp.call('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: false
      });
      const output = join(outputDir, `${state}.png`);
      await writeFile(output, Buffer.from(screenshot.data, 'base64'));
      console.log(`${state}: ${metrics.innerWidth}x${metrics.innerHeight}, shell ${metrics.shell.width.toFixed(1)}px wide, bounds ${metrics.shell.left.toFixed(1)}..${metrics.shell.right.toFixed(1)}`);
    }
  } finally {
    cdp.close();
  }
} catch (error) {
  if (edgeStderr.trim()) console.error(edgeStderr.trim().slice(-4000));
  throw error;
} finally {
  edgeProcess.kill();
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  await rm(profile, { recursive: true, force: true }).catch(() => undefined);
}
