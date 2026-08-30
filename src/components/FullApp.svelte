<script lang="ts">
  import { onMount } from 'svelte';
  import {
    Activity, Archive, ArrowLeft, Boxes, ChevronRight, Code2,
    GitBranch, Globe2, HeartPulse, History, Laptop2, ListRestart, RefreshCw,
    Search, Settings2, Sparkles, SquareTerminal, Trash2, X
  } from '@lucide/svelte';
  import { disable as disableAutostart, enable as enableAutostart, isEnabled as isAutostartEnabled } from '@tauri-apps/plugin-autostart';
  import type { CapsuleSummary, OperationDecision, ServiceSummary, Settings } from '../lib/types';
  import {
    getCapsule, getDiff, getHealth, getHistory, getLiveWorkspace, getLogPaths, getOverview,
    getServices, onAppNavigation, openPath
  } from '../lib/bridge';
  import { formatDate, metricLine, shortenPath } from '../lib/format';
  import CapsuleCard from './CapsuleCard.svelte';
  import Glass from './Glass.svelte';
  import NoteModal from './NoteModal.svelte';
  import PrestartModal from './PrestartModal.svelte';
  import RestoreModal from './RestoreModal.svelte';
  import SaveModal from './SaveModal.svelte';
  import StatusPill from './StatusPill.svelte';

  let { settings, onSettings, busy = false, refreshVersion = 0, onSave, onRestore, onOperation } = $props<{
    settings: Settings;
    refreshVersion?: number;
    onSettings: (settings: Settings) => void;
    busy?: boolean;
    onSave: (payload: { name: string; note: string; ignoreApps: string[] }) => void;
    onRestore: (payload: { capsule: CapsuleSummary; reference?: string; replace: boolean; decisions: OperationDecision[]; only?: string[] }) => void;
    onOperation: (request: any) => void;
  }>();

  type View = 'capsules' | 'live' | 'health' | 'services' | 'settings';
  let view = $state<View>('capsules');
  let capsules = $state<CapsuleSummary[]>([]);
  let search = $state('');
  let selected = $state<CapsuleSummary | null>(null);
  let detail = $state<any>(null);
  let historyData = $state<any>(null);
  let services = $state<ServiceSummary[]>([]);
  let live = $state<any>(null);
  let health = $state<any>(null);
  let loading = $state(true);
  let message = $state('');
  let showSave = $state(false);
  let restoreCapsule = $state<CapsuleSummary | null>(null);
  let restoreReference = $state<string | undefined>();
  let restoreServices = $state<ServiceSummary[]>([]);
  let diffData = $state<any>(null);
  let diffBefore = $state('');
  let diffAfter = $state('');
  let logs = $state<Record<string, string>>({});
  let autostart = $state(false);
  let noteEditorOpen = $state(false);
  let prestartService = $state<ServiceSummary | null>(null);
  let pendingNavigation = $state<{ view?: string | null; capsule?: string | null } | null>(null);

  const filtered = $derived(capsules.filter((capsule) => capsule.name.toLowerCase().includes(search.trim().toLowerCase())));

  async function refreshOverview() {
    loading = true;
    try {
      capsules = (await getOverview()).capsules;
      if (selected) {
        const refreshed = capsules.find((item) => item.name.toLowerCase() === selected!.name.toLowerCase());
        if (refreshed) await openCapsule(refreshed);
        else selected = null;
      }
      if (pendingNavigation) {
        const pending = pendingNavigation;
        pendingNavigation = null;
        await navigate(pending.view, pending.capsule);
      }
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    } finally { loading = false; }
  }

  async function openCapsule(capsule: CapsuleSummary) {
    selected = capsule;
    loading = true;
    try {
      [detail, historyData, services] = await Promise.all([
        getCapsule(capsule.name),
        getHistory(capsule.name),
        getServices(capsule.name).then((value) => value.services)
      ]);
      const revisions = historyData?.revisions ?? [];
      if (revisions.length >= 2) {
        diffBefore = `${capsule.name}@${revisions[1].revision}`;
        diffAfter = `${capsule.name}@${revisions[0].revision}`;
      }
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    } finally { loading = false; }
  }

  async function openRestore(capsule: CapsuleSummary, reference?: string) {
    restoreCapsule = capsule;
    restoreReference = reference ?? `${capsule.name}@${capsule.current_revision}`;
    try { restoreServices = (await getServices(restoreReference)).services; }
    catch { restoreServices = []; }
  }

  async function loadLive() {
    view = 'live'; selected = null; loading = true;
    try { live = await getLiveWorkspace(); }
    catch (error) { message = error instanceof Error ? error.message : String(error); }
    finally { loading = false; }
  }

  async function loadHealth() {
    view = 'health'; selected = null; loading = true;
    try { health = await getHealth(); }
    catch (error) { message = error instanceof Error ? error.message : String(error); }
    finally { loading = false; }
  }

  async function loadServices() {
    view = 'services'; selected = null; loading = true;
    try {
      const groups = await Promise.all(capsules.map(async (capsule) => ({ capsule, services: (await getServices(capsule.name)).services })));
      detail = groups;
    } catch (error) { message = error instanceof Error ? error.message : String(error); }
    finally { loading = false; }
  }

  async function loadSettings() {
    view = 'settings'; selected = null;
    try {
      autostart = await isAutostartEnabled();
      logs = await getLogPaths();
    } catch { /* settings remain usable */ }
  }

  async function compareRevisions() {
    if (!diffBefore || !diffAfter) return;
    loading = true;
    try { diffData = await getDiff(diffBefore, diffAfter); }
    catch (error) { message = error instanceof Error ? error.message : String(error); }
    finally { loading = false; }
  }

  async function toggleAutostart(enabled: boolean) {
    autostart = enabled;
    try { enabled ? await enableAutostart() : await disableAutostart(); }
    catch (error) { message = error instanceof Error ? error.message : String(error); }
    onSettings({ ...settings, startWithWindows: enabled });
  }

  function patchSettings(patch: Partial<Settings>) { onSettings({ ...settings, ...patch }); }

  async function navigate(target?: string | null, capsuleName?: string | null) {
    if (capsuleName) {
      const capsule = capsules.find((item) => item.name.toLowerCase() === capsuleName.toLowerCase());
      if (capsule) { view = 'capsules'; await openCapsule(capsule); return; }
      pendingNavigation = { view: target, capsule: capsuleName };
      if (!loading) await refreshOverview();
      return;
    }
    if (target === 'live') await loadLive();
    else if (target === 'health') await loadHealth();
    else if (target === 'services') await loadServices();
    else if (target === 'settings') await loadSettings();
    else { view = 'capsules'; selected = null; }
  }

  onMount(() => {
    const unsubscribe = onAppNavigation((event) => { navigate(event.view, event.capsule); });
    return () => { unsubscribe.then((stop) => stop()).catch(() => undefined); };
  });

  $effect(() => { refreshVersion; refreshOverview(); });
</script>

<div class="full-root">
  <aside class="sidebar">
    <div class="full-brand"><div class="brand-mark large"><Sparkles size={19}/></div><div><strong>Context Capsule</strong><span>Workspace memory</span></div></div>
    <nav>
      <button class:active={view === 'capsules' && !selected} onclick={() => { view='capsules'; selected=null; }}><Archive size={18}/> Capsules</button>
      <button class:active={view === 'live'} onclick={loadLive}><Activity size={18}/> Live Workspace</button>
      <button class:active={view === 'services'} onclick={loadServices}><ListRestart size={18}/> Services</button>
      <button class:active={view === 'health'} onclick={loadHealth}><HeartPulse size={18}/> System Health</button>
      <button class:active={view === 'settings'} onclick={loadSettings}><Settings2 size={18}/> Settings</button>
    </nav>
    <div class="sidebar-status"><StatusPill state={busy ? 'busy' : 'ready'} label={busy ? 'Working' : 'System ready'}/><span>CLI-backed · API v1</span></div>
  </aside>

  <main class="full-content">
    {#if message}
      <div class="banner warning"><span>{message}</span><button class="icon-button" onclick={() => message=''}><X size={15}/></button></div>
    {/if}

    {#if selected}
      <section class="page">
        <header class="page-header">
          <div class="header-leading"><button class="icon-button" onclick={() => selected=null}><ArrowLeft size={18}/></button><div><span class="section-kicker">Capsule</span><h1>{selected.name}</h1><p>Revision {selected.current_revision} · updated {formatDate(selected.updated_at_unix_ms)}</p></div></div>
          <div class="header-actions"><button class="secondary-button" onclick={() => onOperation({kind:'update', name:selected!.name, ignoreApps: detail?.stored?.snapshot?.capture_options?.ignored_applications ?? []})}><RefreshCw size={15}/> Update</button><button class="primary-button" onclick={() => openRestore(selected!)}><ListRestart size={15}/> Restore</button></div>
        </header>

        <div class="metric-grid">
          <Glass><div class="metric-card"><Laptop2/><strong>{selected.applications}</strong><span>Applications</span></div></Glass>
          <Glass><div class="metric-card"><Globe2/><strong>{selected.browser_tabs}</strong><span>Browser tabs</span></div></Glass>
          <Glass><div class="metric-card"><SquareTerminal/><strong>{selected.terminals}</strong><span>Terminals</span></div></Glass>
          <Glass><div class="metric-card"><ListRestart/><strong>{selected.services}</strong><span>Services</span></div></Glass>
        </div>

        <div class="detail-grid">
          <Glass class="detail-card"><div class="detail-panel"><div class="panel-heading"><div><span class="section-kicker">Saved Services</span><h2>Restart behavior</h2></div></div>
            {#if services.length}
              {#each services as service}
                <div class="service-row"><div class="service-copy"><code>{service.command}</code><span>{service.shell} · {shortenPath(service.working_directory)}</span>{#if service.pre_start_command}<small>Before: {service.pre_start_command}</small>{/if}</div><div class="service-controls"><button class="text-button" onclick={() => prestartService = service}>Pre-start</button><select class="compact-select" value={service.restart_policy} onchange={(e) => onOperation({kind:'service-policy', reference:selected!.name, serviceIndex:service.service_index, policy:(e.currentTarget as HTMLSelectElement).value})}><option value="ask">Ask</option><option value="always">Always</option></select></div></div>
              {/each}
            {:else}<div class="panel-empty">No restartable services saved.</div>{/if}
          </div></Glass>

          <Glass class="detail-card"><div class="detail-panel"><div class="panel-heading"><div><span class="section-kicker">Continuation note</span><h2>{detail?.note?.message ? 'Future-you left a note' : 'No note saved'}</h2></div><button class="text-button" onclick={() => noteEditorOpen = true}>{detail?.note?.message ? 'Edit' : 'Add'}</button></div><p class="note-block">{detail?.note?.message ?? 'Add a note so the important mental context returns with the workspace.'}</p></div></Glass>
        </div>

        <Glass class="history-card"><div class="detail-panel"><div class="panel-heading"><div><span class="section-kicker">History</span><h2>Immutable revisions</h2></div><History size={19}/></div>
          <div class="timeline">
            {#each historyData?.revisions ?? [] as revision}
              <div class="timeline-row"><div class:current={revision.current} class="timeline-dot"></div><div class="timeline-copy"><strong>v{revision.revision}{revision.current ? ' · Current' : ''}</strong><span>{formatDate(revision.created_at_unix_ms)}</span>{#if revision.note}<p>{revision.note}</p>{/if}</div><button class="secondary-button small" onclick={() => openRestore(selected!, `${selected!.name}@${revision.revision}`)}>Restore</button></div>
            {/each}
          </div>
          {#if (historyData?.revisions?.length ?? 0) >= 2}
            <div class="diff-controls"><select bind:value={diffBefore}>{#each historyData.revisions as rev}<option value={`${selected.name}@${rev.revision}`}>v{rev.revision}</option>{/each}</select><ChevronRight size={15}/><select bind:value={diffAfter}>{#each historyData.revisions as rev}<option value={`${selected.name}@${rev.revision}`}>v{rev.revision}</option>{/each}</select><button class="secondary-button small" onclick={compareRevisions}>Compare</button></div>
            {#if diffData}
              <div class="diff-report">{#each diffData.sections ?? [] as section}<div class="diff-section"><strong>{section.name}</strong>{#each section.changes ?? [] as change}<div class={`diff-line ${change.kind?.toLowerCase?.() ?? ''}`}><span>{change.kind === 'added' ? '+' : change.kind === 'removed' ? '−' : '~'}</span><code>{change.key}</code><p>{change.before ? `${change.before} → ` : ''}{change.after ?? ''}</p></div>{/each}</div>{/each}</div>
            {/if}
          {/if}
        </div></Glass>

        <div class="danger-zone"><button class="danger-button" onclick={() => onOperation({kind:'delete', name:selected!.name})}><Trash2 size={15}/> Delete capsule</button></div>
      </section>

    {:else if view === 'capsules'}
      <section class="page">
        <header class="page-header"><div><span class="section-kicker">Library</span><h1>Your Capsules</h1><p>Save whole development contexts and return to them without rebuilding your mental state.</p></div><button class="primary-button" onclick={() => showSave=true}>+ Save Capsule</button></header>
        <div class="library-toolbar"><label class="search-box wide"><Search size={16}/><input bind:value={search} placeholder="Search capsules"/></label><button class="icon-button" onclick={refreshOverview}><RefreshCw size={16}/></button></div>
        <div class="capsule-grid">{#if loading}{#each Array(6) as _}<div class="skeleton-card tall"></div>{/each}{:else}{#each filtered as capsule (capsule.name)}<CapsuleCard {capsule} onrestore={(item)=>openRestore(item)} onopen={openCapsule}/>{/each}{/if}</div>
      </section>

    {:else if view === 'live'}
      <section class="page">
        <header class="page-header"><div><span class="section-kicker">Now</span><h1>Live Workspace</h1><p>What Context Capsule can currently see—without saving anything.</p></div><button class="secondary-button" onclick={loadLive}><RefreshCw size={15}/> Refresh</button></header>
        {#if live}
          <div class="live-summary">
            <Glass><div class="summary-card"><Laptop2/><strong>{live.applications?.length ?? 0}</strong><span>Applications</span></div></Glass>
            <Glass><div class="summary-card"><SquareTerminal/><strong>{live.terminals?.sessions?.length ?? 0}</strong><span>Terminals</span></div></Glass>
            <Glass><div class="summary-card"><Boxes/><strong>{(live.docker?.compose_projects?.length ?? 0)+(live.docker?.standalone_containers?.length ?? 0)}</strong><span>Docker groups</span></div></Glass>
            <Glass><div class="summary-card"><GitBranch/><strong>{live.git?.branch ?? '—'}</strong><span>{live.git?.dirty ? 'Git · changes' : 'Git · clean'}</span></div></Glass>
          </div>
          <Glass class="table-card"><div class="detail-panel"><div class="panel-heading"><div><span class="section-kicker">Applications</span><h2>Visible workspace</h2></div></div><div class="data-list">{#each live.applications ?? [] as app}<div><span class="app-glyph">{app.name?.slice(0,1)}</span><div><strong>{app.name}</strong><span>{app.window_count} window{app.window_count===1?'':'s'} · PID {app.primary_pid}</span></div><code>{shortenPath(app.executable_path)}</code></div>{/each}</div></div></Glass>
          <Glass class="table-card"><div class="detail-panel"><div class="panel-heading"><div><span class="section-kicker">Terminals</span><h2>Interactive sessions</h2></div></div><div class="data-list">{#each live.terminals?.sessions ?? [] as terminal}<div><SquareTerminal size={17}/><div><strong>{terminal.shell}</strong><span>{shortenPath(terminal.working_directory)}</span></div><code>{terminal.foreground_command ?? 'Idle'}</code></div>{/each}</div></div></Glass>
        {/if}
      </section>

    {:else if view === 'services'}
      <section class="page"><header class="page-header"><div><span class="section-kicker">Automation</span><h1>Saved Services</h1><p>Commands that can be restarted inside their restored terminal context.</p></div><button class="secondary-button" onclick={loadServices}><RefreshCw size={15}/> Refresh</button></header>
        <div class="stack-list">{#each detail ?? [] as group}{#if group.services.length}<Glass class="service-group"><div class="detail-panel"><div class="panel-heading"><div><span class="section-kicker">{group.capsule.name}</span><h2>{group.services.length} service{group.services.length===1?'':'s'}</h2></div><button class="secondary-button small" onclick={()=>openCapsule(group.capsule)}>Open capsule</button></div>{#each group.services as service}<div class="service-row"><div><code>{service.command}</code><span>{service.shell} · {shortenPath(service.working_directory)}</span></div><span class="policy-badge">{service.restart_policy}</span></div>{/each}</div></Glass>{/if}{/each}</div>
      </section>

    {:else if view === 'health'}
      <section class="page"><header class="page-header"><div><span class="section-kicker">Diagnostics</span><h1>System Health</h1><p>Actionable integration health without raw terminal output.</p></div><button class="secondary-button" onclick={loadHealth}><RefreshCw size={15}/> Run checks</button></header>
        <div class="health-list">{#each health?.checks ?? [] as check}<Glass><div class={`health-row ${check.status?.toLowerCase()}`}><div class="health-icon"><HeartPulse size={18}/></div><div><strong>{check.component}</strong><span>{check.summary}</span>{#if check.hint}<p>{check.hint}</p>{/if}</div><div class="health-actions"><span class="health-status">{check.status}</span>{#if check.component === 'Firefox/Zen native host' && check.status !== 'ok'}<button class="secondary-button small" onclick={()=>onOperation({kind:'install-browser-host',browser:'firefox'})}>Set up</button>{/if}</div></div></Glass>{/each}</div>
      </section>

    {:else if view === 'settings'}
      <section class="page settings-page"><header class="page-header"><div><span class="section-kicker">Preferences</span><h1>Settings</h1><p>Keep daily behavior simple; technical controls stay out of the way.</p></div></header>
        <Glass class="settings-card"><div class="detail-panel"><span class="section-kicker">General</span>
          <label class="setting-row"><div><strong>Start with Windows</strong><span>Keep Context Capsule available from the system tray.</span></div><input type="checkbox" checked={autostart} onchange={(e)=>toggleAutostart((e.currentTarget as HTMLInputElement).checked)}/></label>
          <label class="setting-row"><div><strong>Completion notifications</strong><span>Use Windows notifications when a background action finishes.</span></div><input type="checkbox" checked={settings.notifications} onchange={(e)=>patchSettings({notifications:(e.currentTarget as HTMLInputElement).checked})}/></label>
          <label class="setting-row"><div><strong>Close quick panel after success</strong><span>Return the tray popup to the background automatically.</span></div><input type="checkbox" checked={settings.autoCloseQuickPanel} onchange={(e)=>patchSettings({autoCloseQuickPanel:(e.currentTarget as HTMLInputElement).checked})}/></label>
        </div></Glass>
        <Glass class="settings-card"><div class="detail-panel"><span class="section-kicker">Appearance</span>
          <label class="setting-row"><div><strong>Reduce motion</strong><span>Disable non-essential glass and progress animation.</span></div><input type="checkbox" checked={settings.reduceMotion} onchange={(e)=>patchSettings({reduceMotion:(e.currentTarget as HTMLInputElement).checked})}/></label>
          <label class="range-row"><div><strong>Glass intensity</strong><span>Refraction/frost strength in supported WebView2 builds.</span></div><input type="range" min="0.06" max="0.24" step="0.01" value={settings.glassIntensity} oninput={(e)=>patchSettings({glassIntensity:Number((e.currentTarget as HTMLInputElement).value)})}/></label>
        </div></Glass>
        <Glass class="settings-card"><div class="detail-panel"><span class="section-kicker">Restore</span>
          <label class="setting-row"><div><strong>Default restore mode</strong><span>Append keeps unrelated apps open; Replace closes them first.</span></div><select class="compact-select" value={settings.restoreMode} onchange={(e)=>patchSettings({restoreMode:(e.currentTarget as HTMLSelectElement).value as 'append'|'replace'})}><option value="append">Append</option><option value="replace">Replace</option></select></label>
        </div></Glass>
        <Glass class="settings-card"><div class="detail-panel"><span class="section-kicker">Integrations</span>
          <div class="integration-settings">
            <div><div><strong>Firefox / Zen native host</strong><span>Install or repair the bundled native messaging bridge.</span></div><button class="secondary-button small" onclick={()=>onOperation({kind:'install-browser-host',browser:'firefox'})}>Set up</button></div>
            <div><div><strong>Chrome native host</strong><span>Install or repair the bundled Chromium native messaging bridge.</span></div><button class="secondary-button small" onclick={()=>onOperation({kind:'install-browser-host',browser:'chrome'})}>Set up</button></div>
          </div>
        </div></Glass>
        <Glass class="settings-card"><div class="detail-panel"><span class="section-kicker">Diagnostics</span><div class="log-buttons">{#each Object.entries(logs) as [name,path]}<button class="secondary-button" onclick={()=>openPath(path)}><Code2 size={15}/>{name} log</button>{/each}</div></div></Glass>
      </section>
    {/if}
  </main>
</div>

{#if showSave}<SaveModal onclose={()=>showSave=false} onsave={(payload)=>{showSave=false;onSave(payload)}}/>{/if}
{#if selected && noteEditorOpen}<NoteModal capsuleName={selected.name} initial={detail?.note?.message ?? ''} onclose={()=>noteEditorOpen=false} onsave={(message)=>{noteEditorOpen=false;onOperation({kind:'note',reference:selected!.name,message})}}/>{/if}
{#if selected && prestartService}<PrestartModal service={prestartService} onclose={()=>prestartService=null} onsave={(command)=>{const service=prestartService!;prestartService=null;onOperation({kind:'service-prestart',reference:selected!.name,serviceIndex:service.service_index,command})}}/>{/if}
{#if restoreCapsule}<RestoreModal capsule={restoreCapsule} reference={restoreReference} services={restoreServices} defaultReplace={settings.restoreMode==='replace'} onclose={()=>restoreCapsule=null} onrestore={(payload)=>{const capsule=restoreCapsule!;const reference=restoreReference;restoreCapsule=null;restoreReference=undefined;onRestore({capsule,reference,...payload})}}/>{/if}
