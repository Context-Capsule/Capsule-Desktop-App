import { mount } from 'svelte';
import App from './App.svelte';
import { traceFrontend } from './lib/bridge';
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

traceFrontend('webview.boot', `href=${window.location.href}`);
mount(App, { target: document.getElementById('app')! });
