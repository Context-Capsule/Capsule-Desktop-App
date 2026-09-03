<script lang="ts">
  import { LoaderCircle, Trash2, TriangleAlert } from '@lucide/svelte';
  import Modal from './Modal.svelte';

  let { name, deleting = false, error = '', onclose, onconfirm } = $props<{
    name: string;
    deleting?: boolean;
    error?: string;
    onclose: () => void;
    onconfirm: () => void;
  }>();

  const close = () => { if (!deleting) onclose(); };
</script>

<Modal title="Delete capsule?" subtitle="This action cannot be undone." onclose={close} width={440}>
  <div class="delete-confirm">
    <div class="delete-confirm-warning">
      <div class="delete-confirm-icon"><TriangleAlert size={19}/></div>
      <div>
        <strong>Remove “{name}” permanently?</strong>
        <p>All saved revisions for this capsule will be removed from local Context Capsule storage. Your project files are not touched.</p>
      </div>
    </div>

    {#if error}
      <div class="delete-confirm-error" role="alert">{error}</div>
    {/if}

    <div class="modal-actions delete-confirm-actions">
      <button class="secondary-button" disabled={deleting} onclick={close}>Cancel</button>
      <button class="danger-button delete-confirm-submit" disabled={deleting} onclick={onconfirm}>
        {#if deleting}<LoaderCircle size={15} class="spin"/> Deleting…{:else}<Trash2 size={15}/> Delete capsule{/if}
      </button>
    </div>
  </div>
</Modal>
