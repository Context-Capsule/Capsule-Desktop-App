<script lang="ts">
  import { onMount } from 'svelte';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import {
    isPermissionGranted,
    requestPermission,
    sendNotification
  } from '@tauri-apps/plugin-notification';
  import type { CapsuleSummary, OperationRequest, Settings, SharedAppState } from './lib/types';
  import { defaultSettings } from './lib/types';
  import {
    cancelOperation,
    contract,
    deleteCapsule,
    dismissSharedOperation,
    getSharedAppState,
    hideQuickPanel,
    markCapsuleDeleted,
    onOnboardingDone,
    onSettingsChanged,
    onSharedAppState,
    onTrayAction,
    publishOnboardingDone,
    publishSettings,
    runOperation
  } from './lib/bridge';
  import DeleteConfirmModal from './components/DeleteConfirmModal.svelte';
  import FullApp from './components/FullApp.svelte';
  import OperationOverlay from './components/OperationOverlay.svelte';
  import Onboarding from './components/Onboarding.svelte';
  import QuickPanel from './components/QuickPanel.svelte';

  const mode = new URLSearchParams(window.location.search).get('mode') === 'full' ? 'full' : 'quick';
  document.documentElement.dataset.windowMode = mode;
  const SETTINGS_KEY = 'context-capsule:settings:v1';
  const ONBOARDING_KEY = 'context-capsule:onboarding:v1';

  const emptySharedState: SharedAppState = {
    generation: 0,
    busy: false,
    operationId: null,
    kind: null,
    title: '',
    phase: '',
    lines: [],
    status: 'idle',
    cancelable: false,
    cancelling: false,
    operationVisible: false,
    dataRevision: 0
  };

  let settings = $state<Settings>(loadSettings());
  let sharedState = $state<SharedAppState>({ ...emptySharedState });
  let busy = $derived(sharedState.busy);
  let refreshVersion = $derived(sharedState.dataRevision);
  let compatibilityError = $state('');
  let trayAction = $state<{ action: 'save' | 'restore-last'; nonce: number } | null>(null);
  let onboardingVisible = $state(localStorage.getItem(ONBOARDING_KEY) !== 'done');
  let pendingDelete = $state<string | null>(null);
  let deleteBusy = $state(false);
  let deleteError = $state('');

  function loadSettings(): Settings {
    try {
      const stored = localStorage.getItem(SETTINGS_KEY);
      return stored ? { ...defaultSettings, ...JSON.parse(stored) } : { ...defaultSettings };
    } catch { return { ...defaultSettings }; }
  }

  function applySettings(next: Settings) {
    settings = { ...defaultSettings, ...next };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    document.documentElement.dataset.reduceMotion = settings.reduceMotion ? 'true' : 'false';
  }

  function saveSettings(next: Settings) {
    applySettings(next);
    void publishSettings(settings).catch(() => undefined);
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
    if (request.kind === 'delete') {
      pendingDelete = request.name;
      deleteError = '';
      return;
    }

    try {
      const result = await runOperation(request);
      if (!result.success) return;

      if (request.kind === 'save' || request.kind === 'restore') {
        await refocusCurrentWindow();
      }
      await notify('Context Capsule', `${titleFor(request)} completed.`);
      if (
        mode === 'quick'
        && settings.autoCloseQuickPanel
        && request.kind !== 'save'
        && request.kind !== 'restore'
      ) {
        setTimeout(() => hideQuickPanel().catch(() => undefined), 1300);
      }
    } catch (error) {
      console.error('Context Capsule operation failed to start or complete', error);
    }
  }

  async function confirmDelete() {
    const name = pendingDelete;
    if (!name || deleteBusy || busy) return;

    deleteBusy = true;
    deleteError = '';
    try {
      await deleteCapsule(name);
      markCapsuleDeleted(name);
      pendingDelete = null;
      void notify('Context Capsule', `Deleted ${name}.`);
    } catch (error) {
      deleteError = error instanceof Error ? error.message : String(error);
    } finally {
      deleteBusy = false;
    }
  }

  async function cancelCurrentSave() {
    const operationId = sharedState.operationId;
    if (!sharedState.cancelable || !operationId || sharedState.cancelling) return;
    try {
      await cancelOperation(operationId);
    } catch (error) {
      console.error('Context Capsule cancellation failed', error);
    }
  }

  async function dismissCurrentOperation() {
    const operationId = sharedState.operationId;
    if (!operationId || sharedState.status === 'running') return;
    try { await dismissSharedOperation(operationId); } catch { /* stale dismissal is harmless */ }
  }

  function saveCapsule(payload: { name: string; note: string; ignoreApps: string[]; captureServices: boolean }) {
    execute({
      kind: 'save',
      name: payload.name,
      note: payload.note || undefined,
      ignoreApps: payload.ignoreApps,
      captureServices: payload.captureServices
    });
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

  function finishOnboarding() {
    localStorage.setItem(ONBOARDING_KEY, 'done');
    onboardingVisible = false;
    void publishOnboardingDone().catch(() => undefined);
  }

  onMount(() => {
    applySettings(settings);
    let disposed = false;

    const acceptSharedState = (next: SharedAppState) => {
      if (!disposed && next.generation >= sharedState.generation) sharedState = next;
    };
    const resyncSharedState = () => {
      if (disposed) return;
      void getSharedAppState().then(acceptSharedState).catch(() => undefined);
    };
    const resyncWhenVisible = () => {
      if (document.visibilityState === 'visible') resyncSharedState();
    };

    const sharedPromise = onSharedAppState(acceptSharedState);
    const settingsPromise = onSettingsChanged((next) => { if (!disposed) applySettings(next); });
    const onboardingPromise = onOnboardingDone(() => {
      if (!disposed) {
        localStorage.setItem(ONBOARDING_KEY, 'done');
        onboardingVisible = false;
      }
    });
    const trayPromise = onTrayAction((event) => { trayAction = event; });

    // Hidden tray WebViews can live for the whole app session. Events are the fast
    // path; focus/visibility snapshots make showing either surface self-healing.
    window.addEventListener('focus', resyncSharedState);
    document.addEventListener('visibilitychange', resyncWhenVisible);
    resyncSharedState();
    contract().catch((error) => { compatibilityError = error instanceof Error ? error.message : String(error); });

    return () => {
      disposed = true;
      window.removeEventListener('focus', resyncSharedState);
      document.removeEventListener('visibilitychange', resyncWhenVisible);
      sharedPromise.then((unsubscribe) => unsubscribe()).catch(() => undefined);
      settingsPromise.then((unsubscribe) => unsubscribe()).catch(() => undefined);
      onboardingPromise.then((unsubscribe) => unsubscribe()).catch(() => undefined);
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
    onfinish={finishOnboarding}
    onInstallBrowser={() => execute({ kind: 'install-browser-host', browser: 'firefox' })}
  />
{/if}

{#if pendingDelete}
  <DeleteConfirmModal
    name={pendingDelete}
    deleting={deleteBusy}
    error={deleteError}
    onclose={() => { if (!deleteBusy) { pendingDelete = null; deleteError = ''; } }}
    onconfirm={confirmDelete}
  />
{/if}

{#if sharedState.operationVisible && sharedState.status !== 'idle'}
  <OperationOverlay
    title={sharedState.title}
    phase={sharedState.phase || 'Preparing…'}
    lines={sharedState.lines}
    status={sharedState.status}
    cancelling={sharedState.cancelling}
    oncancel={sharedState.status === 'running' && sharedState.cancelable && sharedState.operationId ? cancelCurrentSave : undefined}
    onclose={sharedState.status === 'running' ? undefined : dismissCurrentOperation}
  />
{/if}
