<script lang="ts">
  import { onMount } from 'svelte';
  import {
    isPermissionGranted,
    requestPermission,
    sendNotification
  } from '@tauri-apps/plugin-notification';
  import type { CapsuleSummary, OperationEvent, OperationRequest, Settings } from './lib/types';
  import { defaultSettings } from './lib/types';
  import { contract, hideQuickPanel, onOperationEvent, onTrayAction, runOperation } from './lib/bridge';
  import FullApp from './components/FullApp.svelte';
  import OperationOverlay from './components/OperationOverlay.svelte';
  import Onboarding from './components/Onboarding.svelte';
  import QuickPanel from './components/QuickPanel.svelte';

  const mode = new URLSearchParams(window.location.search).get('mode') === 'full' ? 'full' : 'quick';
  const SETTINGS_KEY = 'context-capsule:settings:v1';
  const ONBOARDING_KEY = 'context-capsule:onboarding:v1';

  let settings = $state<Settings>(loadSettings());
  let busy = $state(false);
  let refreshVersion = $state(0);
  let operationTitle = $state('');
  let operationPhase = $state('Preparing…');
  let operationLines = $state<string[]>([]);
  let operationStatus = $state<'running' | 'success' | 'error'>('running');
  let operationVisible = $state(false);
  let operationId = $state('');
  let compatibilityError = $state('');
  let trayAction = $state<{ action: 'save' | 'restore-last'; nonce: number } | null>(null);
  let onboardingVisible = $state(localStorage.getItem(ONBOARDING_KEY) !== 'done');

  function loadSettings(): Settings {
    try {
      const stored = localStorage.getItem(SETTINGS_KEY);
      return stored ? { ...defaultSettings, ...JSON.parse(stored) } : { ...defaultSettings };
    } catch { return { ...defaultSettings }; }
  }

  function saveSettings(next: Settings) {
    settings = next;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    document.documentElement.dataset.reduceMotion = next.reduceMotion ? 'true' : 'false';
  }

  function titleFor(request: OperationRequest): string {
    switch (request.kind) {
      case 'save': return `Saving ${request.name}`;
      case 'update': return `Updating ${request.name}`;
      case 'restore': return `Restoring ${request.reference}`;
      case 'delete': return `Deleting ${request.name}`;
      case 'note': return 'Saving note';
      case 'service-policy': return 'Updating service policy';
      case 'service-prestart': return 'Updating pre-start command';
      case 'install-browser-host': return `Setting up ${request.browser === 'firefox' ? 'Firefox / Zen' : 'Chrome'} integration`; 
    }
  }

  async function notify(title: string, body: string) {
    if (!settings.notifications) return;
    try {
      let granted = await isPermissionGranted();
      if (!granted) granted = (await requestPermission()) === 'granted';
      if (granted) sendNotification({ title, body });
    } catch { /* Notifications are best-effort in dev/uninstalled builds. */ }
  }

  async function execute(request: OperationRequest) {
    if (busy) return;
    if (request.kind === 'delete' && !window.confirm(`Delete “${request.name}” and all of its revisions?`)) return;
    busy = true;
    operationVisible = true;
    operationStatus = 'running';
    operationTitle = titleFor(request);
    operationPhase = 'Preparing…';
    operationLines = [];
    operationId = '';
    try {
      const result = await runOperation(request);
      operationId = result.operationId;
      operationStatus = result.success ? 'success' : 'error';
      operationPhase = result.success ? 'Complete' : 'Action needs attention';
      if (result.success) {
        refreshVersion += 1;
        await notify('Context Capsule', `${operationTitle} completed.`);
        if (mode === 'quick' && settings.autoCloseQuickPanel) {
          setTimeout(() => hideQuickPanel().catch(() => undefined), 1300);
        }
      } else {
        operationLines = [...operationLines, ...result.stderr.split(/\r?\n/).filter(Boolean).slice(-3)];
      }
    } catch (error) {
      operationStatus = 'error';
      operationPhase = error instanceof Error ? error.message : String(error);
      operationLines = [...operationLines, operationPhase];
    } finally {
      busy = false;
    }
  }

  function saveCapsule(payload: { name: string; note: string; ignoreApps: string[] }) {
    execute({ kind: 'save', name: payload.name, note: payload.note || undefined, ignoreApps: payload.ignoreApps });
  }

  function restoreCapsule(payload: { capsule: CapsuleSummary; reference?: string; replace: boolean; decisions: any[]; only?: string[] }) {
    execute({
      kind: 'restore',
      reference: payload.reference ?? payload.capsule.name,
      replace: payload.replace,
      only: payload.only,
      decisions: payload.decisions
    });
  }

  onMount(() => {
    saveSettings(settings);
    const unsubscribePromise = onOperationEvent((event: OperationEvent) => {
      operationId = event.operationId;
      operationPhase = event.phase || operationPhase;
      if (event.text.trim()) operationLines = [...operationLines, event.text.trim()].slice(-8);
    });
    const trayPromise = onTrayAction((event) => { trayAction = event; });
    contract().catch((error) => { compatibilityError = error instanceof Error ? error.message : String(error); });
    return () => {
      unsubscribePromise.then((unsubscribe) => unsubscribe()).catch(() => undefined);
      trayPromise.then((unsubscribe) => unsubscribe()).catch(() => undefined);
    };
  });
</script>

{#if compatibilityError}
  <div class="compatibility-error"><strong>Context Capsule CLI is incompatible</strong><span>{compatibilityError}</span></div>
{/if}

{#if mode === 'quick'}
  <QuickPanel {settings} {busy} {refreshVersion} {trayAction} onSave={saveCapsule} onRestore={restoreCapsule} onOpenCapsule={() => undefined}/>
{:else}
  <FullApp {settings} {busy} {refreshVersion} onSettings={saveSettings} onSave={saveCapsule} onRestore={restoreCapsule} onOperation={execute}/>
{/if}


{#if onboardingVisible}
  <Onboarding
    onfinish={() => { localStorage.setItem(ONBOARDING_KEY, 'done'); onboardingVisible = false; }}
    onInstallBrowser={() => execute({ kind: 'install-browser-host', browser: 'firefox' })}
  />
{/if}

{#if operationVisible}
  <OperationOverlay title={operationTitle} phase={operationPhase} lines={operationLines} status={operationStatus} onclose={operationStatus === 'running' ? undefined : () => operationVisible = false}/>
{/if}
