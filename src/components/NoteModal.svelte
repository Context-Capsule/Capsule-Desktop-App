<script lang="ts">
  import { onMount } from 'svelte';
  import Modal from './Modal.svelte';

  let { capsuleName, initial = '', onclose, onsave } = $props<{
    capsuleName: string;
    initial?: string;
    onclose: () => void;
    onsave: (message: string) => void;
  }>();

  let message = $state('');

  onMount(() => {
    message = initial;
  });
</script>

<Modal title="Continuation Note" subtitle={`Leave context for the next time you restore ${capsuleName}.`} {onclose}>
  <div class="form-stack">
    <label class="field-label">Note
      <textarea class="text-input note-editor" bind:value={message} maxlength="8192" rows="6" placeholder="What should future-you know?"></textarea>
    </label>
    <div class="modal-actions">
      <button class="secondary-button" onclick={onclose}>Cancel</button>
      <button class="primary-button" disabled={!message.trim()} onclick={() => onsave(message.trim())}>Save Note</button>
    </div>
  </div>
</Modal>
