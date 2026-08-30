<script lang="ts">
  import { ChevronDown, LoaderCircle, RefreshCw, ShieldCheck, Wifi, WifiOff } from '@lucide/svelte';
  import { getLiveWorkspace, runOperation } from '../lib/bridge';
  import Modal from './Modal.svelte';

  let { onclose, onsave } = $props<{
    onclose: () => void;
    onsave: (payload: { name: string; note: string; ignoreApps: string[] }) => void;
  }>();

  type DetectedApplication = { name: string; executable_path?: string | null };

  let name = $state('');
  let note = $state('');
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

  function isContextCapsuleApplication(app: DetectedApplication) {
    const appName = app.name.trim().toLowerCase();
    const executable = (app.executable_path ?? '').replace(/\//g, '\\').toLowerCase();
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

  async function loadApplications(force = false) {
    if (loadingApps || (!force && detectedApps.length)) return;
    loadingApps = true;
    appError = '';
    try {
      // Keep Advanced on the same mature live-workspace request that populated
      // this chooser reliably before the newer standalone applications command
      // was introduced. The native layer records begin/end timing in the
      // dedicated application-discovery log, so a future stall is diagnosable
      // without hiding it behind an arbitrary frontend timeout.
      const live = await getLiveWorkspace();
      const applications = (live?.applications ?? [])
        .filter((app: any) => typeof app?.name === 'string' && app.name.trim()) as DetectedApplication[];
      const internal = applications.find(isContextCapsuleApplication);
      internalSelector = internal?.name?.trim() ?? '';
      zenApp = applications.find(isZenApplication) ?? null;
      browserStateKnown = true;
      firefoxFresh = Boolean(live?.browsers?.firefox);
      detectedApps = applications
        .filter((app) => !isContextCapsuleApplication(app))
        .sort((a, b) => displayApplicationName(a.name).localeCompare(displayApplicationName(b.name)));
    } catch (error) {
      browserStateKnown = false;
      appError = error instanceof Error ? error.message : String(error);
    } finally {
      loadingApps = false;
    }
  }

  function toggleIgnored(app: string, checked: boolean) {
    ignoredApps = checked
      ? [...ignoredApps.filter((value) => value !== app), app]
      : ignoredApps.filter((value) => value !== app);
  }

  function toggleAdvanced() {
    advanced = !advanced;
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
      // The Browser Extension intentionally retries native messaging every five
      // seconds after a disconnect. Give that proven reconnect loop enough time
      // before checking semantic state again instead of declaring repair failed
      // after the old 900 ms delay.
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
    onsave({ name: clean, note: note.trim(), ignoreApps: effectiveIgnored });
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

        <div class="field-label"><span>Ignore applications</span><small>Checked applications are intentionally excluded. Only application names are shown; Context Capsule itself is always excluded.</small></div>
        {#if loadingApps && !detectedApps.length}
          <div class="inline-loading"><LoaderCircle size={15} class="spin"/> Detecting applications…</div>
        {:else if appError}
          <div class="inline-warning app-discovery-error"><span>{appError}</span><button class="text-button" onclick={() => loadApplications(true)}>Retry</button></div>
        {:else if detectedApps.length}
          <div class="app-check-list">
            {#each detectedApps as app (app.name)}
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

    <div class="safety-note"><ShieldCheck size={16}/><span>Running terminal services are captured using the CLI's safe force-save transaction. Browser safety is never bypassed silently.</span></div>
    <div class="modal-actions">
      <button class="secondary-button" onclick={onclose}>Cancel</button>
      <button class="primary-button" disabled={!name.trim()} onclick={submit}>Save Capsule</button>
    </div>
  </div>
</Modal>
