<script lang="ts">
  import { ChevronDown, LoaderCircle, RefreshCw, ShieldCheck, Wifi, WifiOff } from '@lucide/svelte';
  import { getFrontendTrace, getLiveWorkspace, runOperation, traceFrontend } from '../lib/bridge';
  import Modal from './Modal.svelte';

  let { onclose, onsave } = $props<{
    onclose: () => void;
    onsave: (payload: { name: string; note: string; ignoreApps: string[]; captureServices: boolean }) => void;
  }>();

  type DetectedApplication = { name: string; executable_path?: string | null };

  let name = $state('');
  let note = $state('');
  let captureServices = $state(true);
  let advanced = $state(false);
  let detectedApps = $state<DetectedApplication[]>([]);
  let ignoredApps = $state<string[]>([]);
  let loadingApps = $state(false);
  let appError = $state('');
  let browserStateKnown = $state(false);
  let firefoxFresh = $state(false);
  let zenApp = $state<DetectedApplication | null>(null);
  let internalSelector = $state('');
  let repairBusy = $state(false);
  let browserMessage = $state('');
  let debugStage = $state('idle');
  let slowLoading = $state(false);
  let diagnosticsCopied = $state(false);

  function isContextCapsuleApplication(app: DetectedApplication) {
    const appName = app.name.trim().toLowerCase();
    const executable = typeof app.executable_path === 'string'
      ? app.executable_path.replace(/\//g, '\\').toLowerCase()
      : '';
    return appName === 'context capsule'
      || appName === 'context-capsule-desktop'
      || executable.endsWith('\\context-capsule-desktop.exe');
  }

  function isZenApplication(app: DetectedApplication) {
    const value = app.name.trim().toLowerCase();
    return value === 'zen' || value === 'zen browser';
  }

  function displayApplicationName(value: string) {
    const appName = value.trim();
    switch (appName.toLowerCase()) {
      case 'zen': return 'Zen';
      case 'windowsterminal': return 'Windows Terminal';
      case 'systemsettings': return 'Settings';
      case 'rtkuwp': return 'Realtek Audio Control';
      default: return appName;
    }
  }

  function uniqueApplications(applications: DetectedApplication[]) {
    const seen = new Set<string>();
    const unique: DetectedApplication[] = [];
    const duplicates: string[] = [];
    for (const app of applications) {
      const key = app.name.trim().toLocaleLowerCase();
      if (seen.has(key)) {
        duplicates.push(app.name.trim());
        continue;
      }
      seen.add(key);
      unique.push(app);
    }
    traceFrontend(
      'save.apps.dedupe',
      `input=${applications.length} unique=${unique.length} duplicates=${duplicates.length}${duplicates.length ? ` duplicate_names=${duplicates.join('|')}` : ''}`
    );
    return unique;
  }

  async function copyDiagnostics() {
    diagnosticsCopied = false;
    const lines = getFrontendTrace().slice(-50).map((entry) => `${entry.at} [${entry.scope}] ${entry.message}`);
    lines.push(`${Date.now()} [save.apps.ui] stage=${debugStage} loading=${loadingApps} detected=${detectedApps.length} advanced=${advanced}`);
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      diagnosticsCopied = true;
      traceFrontend('save.apps.diagnostics', `copied entries=${lines.length}`);
    } catch (error) {
      traceFrontend('save.apps.diagnostics', `copy-failed error=${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function loadApplications(force = false) {
    if (loadingApps || (!force && detectedApps.length)) {
      traceFrontend('save.apps.load', `skipped force=${force} loading=${loadingApps} detected=${detectedApps.length}`);
      return;
    }
    const started = performance.now();
    loadingApps = true;
    slowLoading = false;
    diagnosticsCopied = false;
    appError = '';
    debugStage = 'waiting for live workspace';
    traceFrontend('save.apps.load', `begin force=${force} mode=${new URLSearchParams(window.location.search).get('mode') ?? 'quick'}`);
    const slowTimer = window.setTimeout(() => {
      slowLoading = true;
      traceFrontend('save.apps.load', `slow stage=${debugStage} elapsed_ms=${Math.round(performance.now() - started)}`);
    }, 10_000);
    try {
      const live = await getLiveWorkspace();
      debugStage = 'live workspace returned';
      const rawCount = Array.isArray(live?.applications) ? live.applications.length : -1;
      traceFrontend('save.apps.load', `live-returned elapsed_ms=${Math.round(performance.now() - started)} raw_applications=${rawCount}`);

      debugStage = 'validating applications';
      const applications = uniqueApplications((Array.isArray(live?.applications) ? live.applications : [])
        .filter((app: any) => typeof app?.name === 'string' && app.name.trim()) as DetectedApplication[]);
      traceFrontend('save.apps.load', `validated applications=${applications.length} names=${applications.map((app) => app.name.trim()).join('|')}`);

      debugStage = 'preparing application rows';
      const internal = applications.find(isContextCapsuleApplication);
      internalSelector = internal?.name?.trim() ?? '';
      zenApp = applications.find(isZenApplication) ?? null;
      browserStateKnown = true;
      firefoxFresh = Boolean(live?.browsers?.firefox);
      const visibleApps = applications
        .filter((app) => !isContextCapsuleApplication(app))
        .sort((a, b) => displayApplicationName(a.name).localeCompare(displayApplicationName(b.name)));
      traceFrontend('save.apps.load', `rows-prepared visible=${visibleApps.length} internal=${Boolean(internalSelector)} zen=${Boolean(zenApp)} firefox_fresh=${firefoxFresh}`);

      debugStage = 'assigning application rows';
      detectedApps = visibleApps;
      traceFrontend('save.apps.load', `rows-assigned detected=${detectedApps.length}`);
      debugStage = 'render ready';
    } catch (error) {
      browserStateKnown = false;
      appError = error instanceof Error ? error.message : String(error);
      debugStage = 'failed';
      traceFrontend('save.apps.load', `failed elapsed_ms=${Math.round(performance.now() - started)} error=${appError}`);
    } finally {
      window.clearTimeout(slowTimer);
      loadingApps = false;
      slowLoading = false;
      traceFrontend('save.apps.load', `finally elapsed_ms=${Math.round(performance.now() - started)} stage=${debugStage} detected=${detectedApps.length}`);
    }
  }

  function toggleIgnored(app: string, checked: boolean) {
    ignoredApps = checked
      ? [...ignoredApps.filter((value) => value !== app), app]
      : ignoredApps.filter((value) => value !== app);
  }

  function toggleAdvanced() {
    advanced = !advanced;
    traceFrontend('save.apps.advanced', `toggle advanced=${advanced} loading=${loadingApps} detected=${detectedApps.length}`);
    if (advanced && !loadingApps && !detectedApps.length) void loadApplications();
  }

  async function repairBrowserConnection() {
    if (repairBusy) return;
    repairBusy = true;
    browserMessage = 'Repairing the Firefox / Zen native host…';
    try {
      const result = await runOperation({ kind: 'install-browser-host', browser: 'firefox' });
      if (!result.success) {
        const detail = result.stderr.split(/\r?\n/).filter(Boolean).slice(-2).join(' ');
        throw new Error(detail || 'Firefox / Zen native host repair failed.');
      }
      browserMessage = 'Native host repaired. Waiting for Zen to reconnect…';
      await new Promise((resolve) => setTimeout(resolve, 5_300));
      await loadApplications(true);
      browserMessage = firefoxFresh
        ? 'Firefox / Zen is connected and fresh browser tab state is available.'
        : 'The native host is installed, but the Zen extension has not published fresh state yet. Ensure Context Capsule is installed and enabled in Zen, then reload or interact with the extension and retry.';
    } catch (error) {
      browserMessage = error instanceof Error ? error.message : String(error);
    } finally {
      repairBusy = false;
    }
  }

  const submit = () => {
    const clean = name.trim();
    if (!clean) return;
    const zenIgnored = Boolean(zenApp && ignoredApps.includes(zenApp.name));
    if (browserStateKnown && zenApp && !firefoxFresh && !zenIgnored) {
      advanced = true;
      browserMessage = 'Zen is running but Context Capsule has no fresh tab state. Repair the connection, or explicitly ignore Zen for this capsule.';
      return;
    }
    const effectiveIgnored = Array.from(new Set([
      ...ignoredApps,
      ...(internalSelector ? [internalSelector] : [])
    ]));
    onsave({ name: clean, note: note.trim(), ignoreApps: effectiveIgnored, captureServices });
  };
</script>

<Modal title="Save Capsule" subtitle="Capture the workspace exactly where you are." {onclose}>
  <div class="form-stack">
    <label class="field-label">Name
      <input class="text-input hero-input" bind:value={name} maxlength="128" placeholder="Dino Game" onkeydown={(e) => e.key === 'Enter' && submit()} />
    </label>
    <label class="field-label">Optional note
      <textarea class="text-input" bind:value={note} rows="2" maxlength="8192" placeholder="What should future-you know?"></textarea>
    </label>

    <button class="advanced-toggle" onclick={toggleAdvanced} aria-expanded={advanced}>
      <span>Advanced</span><ChevronDown size={15} class={advanced ? 'rotated' : ''}/>
    </button>
    {#if advanced}
      <div class="advanced-panel">
        {#if zenApp}
          <div class:warning={!firefoxFresh} class="browser-integration-row">
            <div class="browser-integration-copy">
              {#if firefoxFresh}<Wifi size={15}/>{:else}<WifiOff size={15}/>{/if}
              <div><strong>Firefox / Zen integration</strong><small>{firefoxFresh ? 'Connected · fresh browser tab state is available.' : 'Zen is running, but fresh semantic browser state is unavailable.'}</small></div>
            </div>
            {#if !firefoxFresh}
              <button class="secondary-button small" disabled={repairBusy} onclick={repairBrowserConnection}>
                {#if repairBusy}<LoaderCircle size={13} class="spin"/>{:else}<RefreshCw size={13}/>{/if}
                {repairBusy ? 'Repairing…' : 'Repair connection'}
              </button>
            {/if}
          </div>
          {#if browserMessage}<div class="inline-warning browser-message">{browserMessage}</div>{/if}
        {/if}

        <label class="service-capture-row">
          <input type="checkbox" bind:checked={captureServices} />
          <span>
            <strong>Pause & remember running terminal services</strong>
            <small>Recommended. Context Capsule briefly stops running terminal services so their exact commands can be restored later. Turn this off to leave them running and save the rest of the workspace without service restart capture.</small>
          </span>
        </label>

        <div class="field-label"><span>Ignore applications</span><small>Checked applications are intentionally excluded. Only application names are shown; Context Capsule itself is always excluded.</small></div>
        {#if loadingApps && !detectedApps.length}
          <div class="inline-loading"><LoaderCircle size={15} class="spin"/> <span>Detecting applications…<small class="diagnostic-stage">Stage: {debugStage}</small></span></div>
          {#if slowLoading}
            <div class="inline-warning"><span>Discovery is still waiting at “{debugStage}”.</span><button class="text-button" onclick={copyDiagnostics}>{diagnosticsCopied ? 'Copied' : 'Copy diagnostics'}</button></div>
          {/if}
        {:else if appError}
          <div class="inline-warning app-discovery-error"><span>{appError}</span><button class="text-button" onclick={() => loadApplications(true)}>Retry</button><button class="text-button" onclick={copyDiagnostics}>{diagnosticsCopied ? 'Copied' : 'Copy diagnostics'}</button></div>
        {:else if detectedApps.length}
          <div class="app-check-list">
            {#each detectedApps as app}
              <label class="app-check-row">
                <input
                  type="checkbox"
                  checked={ignoredApps.includes(app.name)}
                  onchange={(event) => toggleIgnored(app.name, (event.currentTarget as HTMLInputElement).checked)}
                />
                <span><strong>{displayApplicationName(app.name)}</strong></span>
              </label>
            {/each}
          </div>
        {:else}
          <div class="inline-muted">No user applications are currently detectable.</div>
        {/if}
      </div>
    {/if}

    <div class="safety-note"><ShieldCheck size={16}/><span>{captureServices ? 'Running terminal services will be paused safely, remembered, and made available for restart during restore.' : 'Running terminal services will be left untouched. This capsule will not save service restart commands.'}</span></div>
    <div class="modal-actions">
      <button class="secondary-button" onclick={onclose}>Cancel</button>
      <button class="primary-button" disabled={!name.trim()} onclick={submit}>Save Capsule</button>
    </div>
  </div>
</Modal>

<style>
  .diagnostic-stage {
    display: block;
    margin-top: 2px;
    opacity: .7;
    font-size: 10px;
    font-weight: 500;
  }

  .service-capture-row {
    display: flex;
    align-items: flex-start;
    gap: 9px;
    margin-bottom: 12px;
    padding: 10px;
    border-radius: 11px;
    border: 1px solid rgba(234,255,54,.10);
    background: rgba(234,255,54,.035);
    cursor: pointer;
  }
  .service-capture-row input {
    flex: none;
    margin-top: 2px;
    accent-color: var(--acid);
  }
  .service-capture-row span { min-width: 0; }
  .service-capture-row strong {
    display: block;
    font-size: 9.5px;
  }
  .service-capture-row small {
    display: block;
    margin-top: 3px;
    color: var(--muted);
    font-size: 8px;
    line-height: 1.4;
  }
</style>