<script lang="ts">
  import { onMount } from 'svelte';
  import type { ServiceSummary } from '../lib/types';
  import Modal from './Modal.svelte';

  let { service, onclose, onsave } = $props<{
    service: ServiceSummary;
    onclose: () => void;
    onsave: (command: string | null) => void;
  }>();

  let command = $state('');

  onMount(() => {
    command = service.pre_start_command ?? '';
  });
</script>

<Modal title="Pre-start Command" subtitle="Run setup in the same restored shell before this service starts." {onclose} width={520}>
  <div class="form-stack">
    <div class="service-preview"><span>Service</span><code>{service.command}</code></div>
    <label class="field-label">Run before service
      <textarea class="text-input note-editor" bind:value={command} rows="4" placeholder=". .\venv\Scripts\Activate.ps1"></textarea>
      <small>Leave this empty and choose Clear to remove the saved pre-start step.</small>
    </label>
    <div class="modal-actions split-actions">
      <button class="danger-button subtle-danger" disabled={!service.pre_start_command} onclick={() => onsave(null)}>Clear</button>
      <span class="action-spacer"></span>
      <button class="secondary-button" onclick={onclose}>Cancel</button>
      <button class="primary-button" disabled={!command.trim()} onclick={() => onsave(command.trim())}>Save</button>
    </div>
  </div>
</Modal>
