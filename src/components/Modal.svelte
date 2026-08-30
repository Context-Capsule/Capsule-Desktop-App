<script lang="ts">
  import { X } from '@lucide/svelte';
  import Glass from './Glass.svelte';
  let { title, subtitle, children, onclose, width = 460 } = $props<{
    title: string;
    subtitle?: string;
    children: any;
    onclose: () => void;
    width?: number;
  }>();
</script>

<div class="modal-backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && onclose()}>
  <div class="modal-shell" style={`max-width:${width}px`} role="dialog" aria-modal="true" aria-label={title}>
    <Glass frost={0.18} radius={28}>
      <div class="modal-content">
        <div class="modal-heading">
          <div><h2>{title}</h2>{#if subtitle}<p>{subtitle}</p>{/if}</div>
          <button class="icon-button" title="Close" onclick={onclose}><X size={18}/></button>
        </div>
        <div class="modal-scroll">
          {@render children()}
        </div>
      </div>
    </Glass>
  </div>
</div>
