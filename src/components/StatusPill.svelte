<script lang="ts">
  let { state = 'ready', label = 'Ready' } = $props<{ state?: 'ready' | 'busy' | 'warning' | 'error'; label?: string }>();
</script>

<div class={`status-pill ${state}`}>
  <span class="status-orb"></span>
  <span>{label}</span>
</div>
