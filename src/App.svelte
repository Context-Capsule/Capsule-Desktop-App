<script lang="ts">
  import { onMount } from 'svelte';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import {
    isPermissionGranted,
    requestPermission,
    sendNotification
  } from '@tauri-apps/plugin-notification';
  import type { CapsuleSummary, OperationEvent, OperationRequest, Settings } from './lib/types';
  import { defaultSettings } from './lib/types';
  import { cancelOperation, contract, getLiveWorkspace, hideQuickPanel, onOperationEvent, onTrayAction, runOperation } from './lib/bridge';
  import FullApp from './components/FullApp.svelte';
  import OperationOverlay from './components/OperationOverlay.svelte';
  import Onboarding from './components/Onboarding.svelte';
  import QuickPanel from './components/QuickPanel.svelte';

  const mode = new URLSearchParams(window.location.search).get('mode') === 'full' ? 'full' : 'quick';
  document.documentElement.dataset.windowMode = mode;
  const SETTINGS_KEY = 'context-capsule:settings:v1';
  const ONBOARDING_KEY = 'context-capsule:onboarding:v1';
  const INTERNAL_APP_SELECTOR = 'context-capsule-desktop';

  let settings = $state<Settings>(loadSettings());
  let busy = $state(false);
  let refreshVersion = $state(0);
  let operationTitle = $state('');
  let operationPhase = $state('Preparing…');
  let operationLines = $state<string[]>([]);
  let operationStatus = $state<'running' | 'success' | 'error'>('running');
  let operationVisible = $state(false);
  let operationId = $state('');
  let operationCancelable = $state(false);
  let cancelling = $state(false);
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

  function completionPhase(request: OperationRequest): string {
    if (request.kind === 'save') return 'Capsule saved';
    if (request.kind === 'restore') return 'Capsule restored';
    return 'Complete';
  }

  function isContextCapsuleApplication(app: any) {
    const name = typeof app?.name === 'string' ? app.name.trim().toLowerCase() : '';
    const executable = typeof app?.executable_path === 'string'
      ? app.executable_path.replace(/\//g, '\\').toLowerCase()
      : '';
    return name === 'context capsule'
      || name === INTERNAL_APP_SELECTOR
      || executable.endsWith('\\context-capsule-desktop.exe');
  }

  function isInternalSelector(value: string) {
    const normalized = value.trim().toLowerCase();
    return normalized === 'context capsule' || normalized === INTERNAL_APP_SELECTOR;
  }

  async function withInternalExclusions(request: OperationRequest): Promise<OperationRequest> {
    if (request.kind !== 'save' && request.kind !== 'update') return request;

    // SaveModal preloads live discovery while the user types and includes the exact
    // detected desktop-app selector invisibly. Do not repeat the expensive full
    // discovery when that selector is already present. Update/other call sites
    // keep the authoritative fallback below.
    if (request.ignoreApps.some(isInternalSelector)) return request;

    try {
      const live = await getLiveWorkspace();
      const internalApp = (live?.applications ?? []).find(isContextCapsuleApplication);
      if (internalApp && typeof internalApp.name === 'string' && internalApp.name.trim()) {
        const ignoreApps = Array.from(new Set([...(request.ignoreApps ?? []), internalApp.name.trim()]));
        return { ...request, ignoreApps };
      }
    } catch { /* The operation itself remains authoritative if live discovery is unavailable. */ }
    return request;
  }

  function appendUniqueOperationLines(candidates: string[]) {
    const next = [...operationLines];
    for (const candidate of candidates) {
      const clean = candidate.trim();
      if (clean && !next.includes(clean)) next.push(clean);
    }
    operationLines = next.slice(-8);
  }

  async function refocusCurrentWindow() {
    try {
      const current = getCurrentWindow();
      await current.show();
      await current.setFocus();
    } catch { /* Focus recovery is best-effort if the native window is closing. */ }
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
    const effectiveRequest = await withInternalExclusions(request);
    busy = true;
    operationVisible = true;
    operationStatus = 'running';
    operationTitle = titleFor(effectiveRequest);
    operationPhase = 'Preparing…';
    operationLines = [];
    operationId = '';
    operationCancelable = effectiveRequest.kind === 'save';
    cancelling = false;
    try {
      const result = await runOperation(effectiveRequest);
      operationId = result.operationId;
      if (result.cancelled) {
        operationStatus = 'error';
        operationPhase = 'Cancelled';
        appendUniqueOperationLines(['Save cancelled. No new capsule was kept.']);
      } else {
        operationStatus = result.success ? 'success' : 'error';
        operationPhase = result.success ? completionPhase(effectiveRequest) : 'Action needs attention';
        if (result.success) {
          refreshVersion += 1;
          if (effectiveRequest.kind === 'save' || effectiveRequest.kind === 'restore') {
            await refocusCurrentWindow();
          }
          await notify('Context Capsule', `${operationTitle} completed.`);
          if (
            mode === 'quick'
            && settings.autoCloseQuickPanel
            && effectiveRequest.kind !== 'save'
            && effectiveRequest.kind !== 'restore'
          ) {
            setTimeout(() => hideQuickPanel().catch(() => undefined), 1300);
          }
        } else {
          // stderr was already streamed through operation-progress. Only append
          // genuinely new tail lines so one CLI preflight error is never shown twice.
          appendUniqueOperationLines(result.stderr.split(/\r?\n/).filter(Boolean).slice(-3));
        }
      }
    } catch (error) {
      operationStatus = 'error';
      operationPhase = error instanceof Error ? error.message : String(error);
      appendUniqueOperationLines([operationPhase]);
    } finally {
      busy = false;
      operationCancelable = false;
      cancelling = false;
    }
  }

  async function cancelCurrentSave() {
    if (!operationCancelable || !operationId || cancelling) return;
    cancelling = true;
    operationPhase = 'Cancelling…';
    try {
      await cancelOperation(operationId);
    } catch (error) {
      cancelling = false;
      operationPhase = error instanceof Error ? error.message : String(error);
      appendUniqueOperationLines([operationPhase]);
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
      appendUniqueOperationLines([event.text]);
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
  <OperationOverlay
    title={operationTitle}
    phase={operationPhase}
    lines={operationLines}
    status={operationStatus}
    cancelling={cancelling}
    oncancel={operationStatus === 'running' && operationCancelable && operationId ? cancelCurrentSave : undefined}
    onclose={operationStatus === 'running' ? undefined : () => operationVisible = false}
  />
{/if}
