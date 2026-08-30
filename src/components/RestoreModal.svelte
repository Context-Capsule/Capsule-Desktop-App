<script lang="ts">
  import { AppWindow, Boxes, ChevronDown, Code2, FolderOpen, GitBranch, Globe2, SquareTerminal } from '@lucide/svelte';
  import type { CapsuleSummary, OperationDecision, ServiceSummary } from '../lib/types';
  import Modal from './Modal.svelte';

  let { capsule, reference, services = [], defaultReplace = false, onclose, onrestore } = $props<{
    capsule: CapsuleSummary;
    reference?: string;
    services?: ServiceSummary[];
    defaultReplace?: boolean;
    onclose: () => void;
    onrestore: (payload: { replace: boolean; decisions: OperationDecision[]; only: string[] }) => void;
  }>();

  const revisionLabel = $derived(reference?.match(/@(\d+)$/)?.[1] ?? String(capsule.current_revision));

  let replace = $state(false);
  let decisions = $state<Record<number, 'once' | 'always' | 'skip'>>({});
  let advanced = $state(false);
  const resourceOptions = [
    { key: 'apps', label: 'Applications', icon: AppWindow },
    { key: 'vscode', label: 'VS Code', icon: Code2 },
    { key: 'browsers', label: 'Browsers', icon: Globe2 },
    { key: 'terminals', label: 'Terminals', icon: SquareTerminal },
    { key: 'git', label: 'Git', icon: GitBranch },
    { key: 'docker', label: 'Docker', icon: Boxes },
    { key: 'explorer', label: 'Explorer', icon: FolderOpen },
  ];
  const allResourceKeys = resourceOptions.map((item) => item.key);
  let selectedResources = $state<string[]>([...allResourceKeys]);

  $effect(() => {
    replace = defaultReplace;
    if (defaultReplace) selectedResources = [...allResourceKeys];
  });

  $effect(() => {
    for (const service of services) {
      if (!(service.service_index in decisions)) {
        decisions[service.service_index] = service.restart_policy === 'always' ? 'always' : 'once';
      }
    }
  });

  function toggleResource(key: string, checked: boolean) {
    if (replace) return;
    selectedResources = checked
      ? [...selectedResources.filter((value) => value !== key), key]
      : selectedResources.filter((value) => value !== key);
  }

  function setReplace(checked: boolean) {
    replace = checked;
    // The mature CLI intentionally rejects --replace combined with --only:
    // replace may close unrelated applications, so a partial restore would be
    // unsafe. Switching to Replace therefore makes the operation whole-capsule.
    if (checked) selectedResources = [...allResourceKeys];
  }

  const submit = () => onrestore({
    replace,
    only: replace || selectedResources.length === resourceOptions.length
      ? []
      : allResourceKeys.filter((key) => selectedResources.includes(key)),
    decisions: services
      .filter((service: ServiceSummary) => service.restart_policy !== 'always')
      .map((service: ServiceSummary) => ({ serviceIndex: service.service_index, decision: decisions[service.service_index] ?? 'once' }))
  });
</script>

<Modal title={`Restore “${capsule.name}”?`} subtitle={`Revision ${revisionLabel} · ${capsule.revision_count} version${capsule.revision_count === 1 ? '' : 's'} saved`} {onclose} width={520}>
  <div class="restore-summary-grid">
    <div><AppWindow size={17}/><strong>{capsule.applications}</strong><span>Apps</span></div>
    <div><Globe2 size={17}/><strong>{capsule.browser_tabs}</strong><span>Tabs</span></div>
    <div><SquareTerminal size={17}/><strong>{capsule.terminals}</strong><span>Terminals</span></div>
    <div><Boxes size={17}/><strong>{capsule.docker_containers}</strong><span>Containers</span></div>
  </div>

  {#if services.length}
    <div class="service-choice-list">
      <div class="section-kicker">Restart services</div>
      {#each services as service}
        <div class="service-choice">
          <div class="service-choice-copy">
            <code>{service.command}</code>
            <span>{service.shell}{service.working_directory ? ` · ${service.working_directory}` : ''}</span>
          </div>
          {#if service.restart_policy === 'always'}
            <span class="policy-badge">Always</span>
          {:else}
            <select class="compact-select" bind:value={decisions[service.service_index]}>
              <option value="once">Start this time</option>
              <option value="always">Always start</option>
              <option value="skip">Skip</option>
            </select>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  <button class="advanced-toggle" onclick={() => advanced = !advanced} aria-expanded={advanced}>
    <span>Restore options</span><ChevronDown size={15} class={advanced ? 'rotated' : ''}/>
  </button>
  {#if advanced}
    <div class="advanced-panel restore-resource-panel">
      <div class="field-label">
        <span>Resources</span>
        <small>{replace ? 'Replace mode restores the whole capsule so excluded applications are never closed accidentally.' : 'Choose which parts of the capsule to restore. All are selected by default.'}</small>
      </div>
      <div class="resource-grid">
        {#each resourceOptions as option}
          {@const Icon = option.icon}
          <label class="resource-choice">
            <input type="checkbox" disabled={replace} checked={selectedResources.includes(option.key)} onchange={(event) => toggleResource(option.key, (event.currentTarget as HTMLInputElement).checked)}/>
            <Icon size={14}/><span>{option.label}</span>
          </label>
        {/each}
      </div>
    </div>
  {/if}

  <label class="toggle-row">
    <div><strong>Replace mode</strong><span>Close unrelated apps before restoring the complete capsule.</span></div>
    <input type="checkbox" checked={replace} onchange={(event) => setReplace((event.currentTarget as HTMLInputElement).checked)}/><span class="toggle-ui"></span>
  </label>

  <div class="modal-actions">
    <button class="secondary-button" onclick={onclose}>Cancel</button>
    <button class="primary-button" disabled={selectedResources.length === 0} onclick={submit}>Restore Workspace</button>
  </div>
</Modal>


