<script lang="ts">
  import { Box, ChevronRight, Clock3, MoreHorizontal, RotateCcw } from '@lucide/svelte';
  import type { CapsuleSummary } from '../lib/types';
  import { metricLine, relativeTime } from '../lib/format';
  import Glass from './Glass.svelte';

  let { capsule, compact = false, onrestore, onopen, onmenu } = $props<{
    capsule: CapsuleSummary;
    compact?: boolean;
    onrestore: (capsule: CapsuleSummary) => void;
    onopen: (capsule: CapsuleSummary) => void;
    onmenu?: (capsule: CapsuleSummary) => void;
  }>();

  const metrics = $derived(metricLine([
    [capsule.applications, 'apps'],
    [capsule.browser_tabs, 'tabs'],
    [capsule.terminals, 'terminals'],
    [capsule.services, 'services']
  ]));
</script>

<div class:compact class="capsule-card-shell">
  <Glass interactive frost={0.1} radius={22}>
    <div class="capsule-card" role="group" aria-label={`${capsule.name} capsule`}>
      <button class="capsule-main" onclick={() => onopen(capsule)}>
        <div class="capsule-icon"><Box size={18} strokeWidth={1.8} /></div>
        <div class="capsule-copy">
          <div class="capsule-title-row">
            <strong>{capsule.name}</strong>
            <span class="version">v{capsule.current_revision}</span>
          </div>
          <span class="metrics">{metrics}</span>
          {#if !compact && capsule.note}
            <span class="note">{capsule.note}</span>
          {/if}
        </div>
      </button>
      <div class="capsule-side">
        <span class="time"><Clock3 size={12} /> {relativeTime(capsule.updated_at_unix_ms)}</span>
        <div class="card-actions">
          {#if onmenu}
            <button class="icon-button subtle" title="More actions" onclick={() => onmenu?.(capsule)}><MoreHorizontal size={16}/></button>
          {/if}
          <button class="restore-button" onclick={() => onrestore(capsule)}>
            <RotateCcw size={15}/><span>Restore</span><ChevronRight size={14}/>
          </button>
        </div>
      </div>
    </div>
  </Glass>
</div>
