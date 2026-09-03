<script lang="ts">
  import { Activity, ArrowUpRight, Box, HeartPulse, Plus, Search, Settings2, Sparkles } from '@lucide/svelte';
  import type { CapsuleSummary, OperationDecision, ServiceSummary, Settings } from '../lib/types';
  import { getOverview, getServices, hideQuickPanel, showMainWindow } from '../lib/bridge';
  import CapsuleCard from './CapsuleCard.svelte';
  import Glass from './Glass.svelte';
  import RestoreModal from './RestoreModal.svelte';
  import SaveModal from './SaveModal.svelte';
  import StatusPill from './StatusPill.svelte';

  let { settings, busy = false, refreshVersion = 0, trayAction = null, onSave, onRestore, onOpenCapsule } = $props<{
    settings: Settings;
    busy?: boolean;
    refreshVersion?: number;
    trayAction?: { action: 'save' | 'restore-last'; nonce: number } | null;
    onSave: (payload: { name: string; note: string; ignoreApps: string[]; captureServices: boolean }) => void;
    onRestore: (payload: { capsule: CapsuleSummary; reference?: string; replace: boolean; decisions: OperationDecision[]; only?: string[] }) => void;
    onOpenCapsule: (capsule: CapsuleSummary) => void;
  }>();

  let capsules = $state<CapsuleSummary[]>([]);
  let loading = $state(true);
  let error = $state('');
  let showSave = $state(false);
  let restoreCapsule = $state<CapsuleSummary | null>(null);
  let restoreServices = $state<ServiceSummary[]>([]);
  let query = $state('');

  const filtered = $derived(capsules.filter((capsule) => capsule.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 6));

  async function refresh() {
    loading = true;
    error = '';
    try {
      capsules = (await getOverview()).capsules;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading = false;
    }
  }

  async function openRestore(capsule: CapsuleSummary) {
    restoreCapsule = capsule;
    try {
      restoreServices = (await getServices(capsule.name)).services;
    } catch {
      restoreServices = [];
    }
  }

  async function openFull(view: 'capsules' | 'live' | 'health' | 'services' | 'settings' = 'capsules', capsule?: CapsuleSummary) {
    await showMainWindow(view, capsule?.name);
    await hideQuickPanel();
  }

  let handledTrayNonce = $state(0);
  $effect(() => { refreshVersion; refresh(); });
  $effect(() => {
    if (!trayAction || trayAction.nonce === handledTrayNonce) return;
    handledTrayNonce = trayAction.nonce;
    if (trayAction.action === 'save') showSave = true;
    if (trayAction.action === 'restore-last') {
      void (async () => {
        if (!capsules.length) await refresh();
        if (capsules[0]) await openRestore(capsules[0]);
      })();
    }
  });
</script>

<div class="quick-root">
  <Glass frost={settings.glassIntensity} radius={30}>
    <div class="quick-panel">
      <header class="quick-header">
        <div class="brand-lockup">
          <div class="brand-mark"><Sparkles size={17}/></div>
          <div><strong>Context Capsule</strong><span>Workspace memory</span></div>
        </div>
        <StatusPill state={busy ? 'busy' : error ? 'warning' : 'ready'} label={busy ? 'Working' : error ? 'Attention' : 'Ready'} />
      </header>

      <button class="save-hero" disabled={busy} onclick={() => showSave = true}>
        <span class="save-icon"><Plus size={23}/></span>
        <span><strong>Save Capsule</strong><small>Capture your current workspace</small></span>
        <ArrowUpRight size={17}/>
      </button>

      <div class="quick-section-heading">
        <div><span class="section-kicker">Recent Capsules</span><strong>{capsules.length ? `${capsules.length} saved` : 'Your workspaces'}</strong></div>
        <button class="icon-button subtle" title="Refresh" onclick={refresh}><Activity size={16}/></button>
      </div>

      {#if capsules.length > 4}
        <label class="search-box"><Search size={15}/><input bind:value={query} placeholder="Find a capsule" /></label>
      {/if}

      <div class="quick-capsules">
        {#if loading}
          {#each Array(3) as _}<div class="skeleton-card"></div>{/each}
        {:else if error}
          <div class="empty-state warning"><HeartPulse size={20}/><strong>CLI connection needs attention</strong><p>{error}</p><button class="secondary-button small" onclick={refresh}>Try again</button></div>
        {:else if filtered.length}
          {#each filtered as capsule (capsule.name)}
            <CapsuleCard {capsule} compact disabled={busy} onrestore={openRestore} onopen={(item) => { onOpenCapsule(item); openFull('capsules', item); }} />
          {/each}
        {:else}
          <div class="empty-state"><Box size={22}/><strong>No capsules yet</strong><p>Save this workspace and it will appear here.</p></div>
        {/if}
      </div>

      <footer class="quick-footer">
        <button onclick={() => openFull('live')}><Activity size={16}/><span>Workspace</span></button>
        <button onclick={() => openFull('health')}><HeartPulse size={16}/><span>Health</span></button>
        <button onclick={() => openFull('settings')}><Settings2 size={16}/><span>Settings</span></button>
        <button class="open-full" onclick={() => openFull('capsules')} title="Open full app"><ArrowUpRight size={16}/></button>
      </footer>
    </div>
  </Glass>
</div>

{#if showSave}
  <SaveModal onclose={() => showSave = false} onsave={(payload) => { showSave = false; onSave(payload); }} />
{/if}
{#if restoreCapsule}
  <RestoreModal capsule={restoreCapsule} reference={`${restoreCapsule.name}@${restoreCapsule.current_revision}`} services={restoreServices} defaultReplace={settings.restoreMode === 'replace'} onclose={() => restoreCapsule = null} onrestore={(payload) => { const capsule = restoreCapsule!; restoreCapsule = null; onRestore({ capsule, reference: `${capsule.name}@${capsule.current_revision}`, ...payload }); }} />
{/if}
