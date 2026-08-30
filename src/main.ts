import { mount } from 'svelte';
import App from './App.svelte';
import { getFrontendTrace, traceFrontend } from './lib/bridge';
import './app.css';
import './glass-overrides.css';
import 'simple-liquid-glass/web-component';

window.addEventListener('error', (event) => {
  const detail = event.error instanceof Error
    ? `${event.error.name}: ${event.error.message}`
    : event.message || 'unknown window error';
  traceFrontend('webview.error', `${detail} at ${event.filename || 'unknown'}:${event.lineno || 0}:${event.colno || 0}`);
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason instanceof Error
    ? `${event.reason.name}: ${event.reason.message}`
    : String(event.reason);
  traceFrontend('webview.unhandledrejection', reason);
});

window.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'd')) return;
  event.preventDefault();
  const text = getFrontendTrace()
    .slice(-80)
    .map((entry) => `${entry.at} [${entry.scope}] ${entry.message}`)
    .join('\n');
  navigator.clipboard.writeText(text)
    .then(() => traceFrontend('webview.diagnostics', `clipboard-copy success entries=${getFrontendTrace().length}`))
    .catch((error) => traceFrontend('webview.diagnostics', `clipboard-copy failed error=${error instanceof Error ? error.message : String(error)}`));
});

traceFrontend('webview.boot', `href=${window.location.href}`);
mount(App, { target: document.getElementById('app')! });
