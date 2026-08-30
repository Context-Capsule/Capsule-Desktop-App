<script lang="ts">
  import { Check, CircleAlert, LoaderCircle, SquareTerminal, X } from '@lucide/svelte';
  import Glass from './Glass.svelte';
  let { title, phase = 'Preparing…', lines = [], status = 'running', onclose, oncancel, cancelling = false } = $props<{
    title: string;
    phase?: string;
    lines?: string[];
    status?: 'running' | 'success' | 'error';
    onclose?: () => void;
    oncancel?: () => void;
    cancelling?: boolean;
  }>();
</script>

<div class="operation-overlay">
  <div class="operation-shell">
    <Glass frost={0.19} radius={28}>
      <div class="operation-card">
        <div class={`operation-symbol ${status}`}>
          {#if status === 'running'}<LoaderCircle size={27} class="spin"/>
          {:else if status === 'success'}<Check size={27}/>
          {:else}<CircleAlert size={27}/>{/if}
        </div>
        <h2>{title}</h2>
        <p class="operation-phase">{phase}</p>
        <div class="progress-track"><span class:done={status !== 'running'}></span></div>
        {#if lines.length}
          <div class="operation-log">
            <div class="mini-label"><SquareTerminal size={13}/> Live activity</div>
            {#each lines.slice(-4) as line}<p>{line}</p>{/each}
          </div>
        {/if}
        {#if status === 'running' && oncancel}
          <button class="secondary-button small operation-cancel" disabled={cancelling} onclick={oncancel}>
            <X size={14}/>{cancelling ? 'Cancelling…' : 'Cancel save'}
          </button>
        {:else if status !== 'running' && onclose}
          <button class="primary-button small" onclick={onclose}>Done</button>
        {/if}
      </div>
    </Glass>
  </div>
</div>
