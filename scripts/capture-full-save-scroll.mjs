import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const width = 1100;
const height = 760;

function findEdge() {
  return [
    process.env.EDGE_PATH,
    process.env['ProgramFiles(x86)'] && join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.ProgramFiles && join(process.env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ].filter(Boolean).find((candidate) => existsSync(candidate));
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
    if (this.socket.readyState !== WebSocket.OPEN) {
      await new Promise((resolveOpen, reject) => {
        this.socket.addEventListener('open', resolveOpen, { once: true });
        this.socket.addEventListener('error', reject, { once: true });
      });
    }
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

async function screenshot(cdp, path) {
  const image = await cdp.call('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false
  });
  await writeFile(path, Buffer.from(image.data, 'base64'));
}

const edge = findEdge();
if (!edge) throw new Error('Microsoft Edge is unavailable for full-app visual validation.');
if (typeof WebSocket === 'undefined') throw new Error('Node.js WebSocket support is required for visual validation.');

const outputDir = join(root, 'screenshots', 'full');
await mkdir(outputDir, { recursive: true });
const fixture = pathToFileURL(join(root, 'tests', 'visual', 'full-save-scroll.html')).href;
const port = await reservePort();
const profile = join(process.env.RUNNER_TEMP ?? os.tmpdir(), `context-capsule-full-scroll-${process.pid}`);
await rm(profile, { recursive: true, force: true });

const edgeProcess = spawn(edge, [
  '--headless=new',
  '--disable-gpu',
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

    const loaded = cdp.waitEvent('Page.loadEventFired');
    await cdp.call('Page.navigate', { url: fixture });
    await loaded;

    const measured = await cdp.call('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const list = document.querySelector('.app-check-list');
        if (!list) return null;
        const rect = list.getBoundingClientRect();
        const style = getComputedStyle(list);
        return {
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          clientHeight: list.clientHeight,
          scrollHeight: list.scrollHeight,
          scrollTop: list.scrollTop,
          overflowY: style.overflowY,
          scrollbarWidth: style.scrollbarWidth,
          rect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }
        };
      })()`
    });
    const metrics = measured.result?.value;
    if (!metrics) throw new Error('Full Save application list was not found.');
    if (metrics.innerWidth !== width || metrics.innerHeight !== height) {
      throw new Error(`Expected ${width}x${height} CSS viewport, got ${metrics.innerWidth}x${metrics.innerHeight}`);
    }
    if (metrics.overflowY !== 'auto') throw new Error(`Application list overflow-y is ${metrics.overflowY}, expected auto.`);
    if (metrics.scrollbarWidth !== 'none') throw new Error(`Application list scrollbar-width is ${metrics.scrollbarWidth}, expected none.`);
    if (metrics.scrollHeight <= metrics.clientHeight) {
      throw new Error(`Application list does not overflow: scrollHeight=${metrics.scrollHeight}, clientHeight=${metrics.clientHeight}`);
    }
    if (metrics.rect.top < 0 || metrics.rect.bottom > height || metrics.rect.left < 0 || metrics.rect.right > width) {
      throw new Error(`Application list escapes viewport: ${JSON.stringify(metrics.rect)}`);
    }

    await screenshot(cdp, join(outputDir, 'save-ignore-scroll-top.png'));

    const scrolled = await cdp.call('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const list = document.querySelector('.app-check-list');
        list.scrollTop = list.scrollHeight;
        return { scrollTop: list.scrollTop, maxScroll: list.scrollHeight - list.clientHeight };
      })()`
    });
    const after = scrolled.result?.value;
    if (!after || after.scrollTop <= 0 || after.maxScroll <= 0) {
      throw new Error(`Application list did not scroll: ${JSON.stringify(after)}`);
    }
    if (Math.abs(after.scrollTop - after.maxScroll) > 2) {
      throw new Error(`Application list did not reach the bottom: ${JSON.stringify(after)}`);
    }

    await screenshot(cdp, join(outputDir, 'save-ignore-scroll-bottom.png'));
    console.log(`full-save-scroll: client=${metrics.clientHeight}px scroll=${metrics.scrollHeight}px maxScroll=${after.maxScroll}px; hidden scrollbar verified by CSS`);
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
