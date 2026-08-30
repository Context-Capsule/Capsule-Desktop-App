<script lang="ts">
  import { onMount } from 'svelte';
  import { ChevronDown, LoaderCircle, ShieldCheck } from '@lucide/svelte';
  import { getLiveWorkspace } from '../lib/bridge';
  import Modal from './Modal.svelte';

  let { onclose, onsave } = $props<{
    onclose: () => void;
    onsave: (payload: { name: string; note: string; ignoreApps: string[] }) => void;
  }>();

  let name = $state('');
  let note = $state('');
  let advanced = $state(false);
  let detectedApps = $state<Array<{ name: string; executable_path?: string | null }>>([]);
  let ignoredApps = $state<string[]>([]);
  let loadingApps = $state(false);
  let appError = $state('');

  async function loadApplications() {
    if (loadingApps || detectedApps.length) return;
    loadingApps = true;
    appError = '';
    try {
      const live = await getLiveWorkspace();
      detectedApps = (live?.applications ?? [])
        .filter((app: any) => typeof app?.name === 'string' && app.name.trim())
        .sort((a: any, b: any) => a.name.localeCompare(b.name));
    } catch (error) {
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
    if (advanced) loadApplications();
  }

  const submit = () => {
    const clean = name.trim();
    if (!clean) return;
    onsave({ name: clean, note: note.trim(), ignoreApps: ignoredApps });
  };

  onMount(() => {
    // Do not pay for full desktop discovery until Advanced is opened.
  });
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
        <div class="field-label"><span>Ignore applications</span><small>Unchecked applications remain part of the capsule. The CLI validates every exclusion before anything is stopped.</small></div>
        {#if loadingApps}
          <div class="inline-loading"><LoaderCircle size={15} class="spin"/> Detecting applications…</div>
        {:else if appError}
          <div class="inline-warning">Could not load application choices. Saving without exclusions is still safe.</div>
        {:else if detectedApps.length}
          <div class="app-check-list">
            {#each detectedApps as app (app.name)}
              <label class="app-check-row">
                <input
                  type="checkbox"
                  checked={ignoredApps.includes(app.name)}
                  onchange={(event) => toggleIgnored(app.name, (event.currentTarget as HTMLInputElement).checked)}
                />
                <span><strong>{app.name}</strong>{#if app.executable_path}<small>{app.executable_path}</small>{/if}</span>
              </label>
            {/each}
          </div>
        {:else}
          <div class="inline-muted">No user applications are currently detectable.</div>
        {/if}
      </div>
    {/if}

    <div class="safety-note"><ShieldCheck size={16}/><span>Running terminal services are captured using the CLI's safe force-save transaction.</span></div>
    <div class="modal-actions">
      <button class="secondary-button" onclick={onclose}>Cancel</button>
      <button class="primary-button" disabled={!name.trim()} onclick={submit}>Save Capsule</button>
    </div>
  </div>
</Modal>

