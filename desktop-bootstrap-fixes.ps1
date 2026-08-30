$ErrorActionPreference = 'Stop'

# Apply only fixes proven by POTUS validation logs. This file is staging-only;
# the bootstrap workflow copies it to RUNNER_TEMP before replacing the tree.
$package = Get-Content -Raw package.json | ConvertFrom-Json
if (-not $package.devDependencies.PSObject.Properties['@types/node']) {
  $package.devDependencies | Add-Member -NotePropertyName '@types/node' -NotePropertyValue '^24.3.0'
}
if (-not $package.devDependencies.PSObject.Properties['esbuild']) {
  $package.devDependencies | Add-Member -NotePropertyName 'esbuild' -NotePropertyValue '^0.25.0'
}
$package | ConvertTo-Json -Depth 20 | Set-Content package.json -Encoding utf8

$ts = Get-Content -Raw tsconfig.json | ConvertFrom-Json
if ($ts.compilerOptions.PSObject.Properties['lib']) {
  $ts.compilerOptions.lib = @('ESNext', 'DOM', 'DOM.Iterable')
} else {
  $ts.compilerOptions | Add-Member -NotePropertyName 'lib' -NotePropertyValue @('ESNext', 'DOM', 'DOM.Iterable')
}
if ($ts.compilerOptions.PSObject.Properties['types']) {
  $ts.compilerOptions.types = @('svelte', 'node')
} else {
  $ts.compilerOptions | Add-Member -NotePropertyName 'types' -NotePropertyValue @('svelte', 'node')
}
$ts | ConvertTo-Json -Depth 20 | Set-Content tsconfig.json -Encoding utf8

foreach ($file in @('src\components\SaveModal.svelte', 'src\components\RestoreModal.svelte')) {
  $text = Get-Content -Raw $file
  $text = $text.Replace('class:rotated={advanced}', "class={advanced ? 'rotated' : ''}")
  $text = $text.Replace(' autofocus', '')
  $text = $text -replace '<textarea([^>]*)\s*/>', '<textarea$1></textarea>'
  Set-Content -LiteralPath $file -Value $text -Encoding utf8
}

$restore = Get-Content -Raw 'src\components\RestoreModal.svelte'
$restore = $restore -replace '\.filter\(\(service\)\s*=>', '.filter((service: ServiceSummary) =>'
$restore = $restore -replace '\.map\(\(service\)\s*=>', '.map((service: ServiceSummary) =>'
# Avoid Svelte's initial-prop capture warning while preserving the requested default.
if ($restore -notmatch "import \{ onMount \} from 'svelte';") {
  $restore = $restore.Replace("<script lang=`"ts`">", "<script lang=`"ts`">`r`n  import { onMount } from 'svelte';")
}
$restore = $restore.Replace('let replace = $state(defaultReplace);', "let replace = `$state(false);`r`n  onMount(() => { replace = defaultReplace; });")
Set-Content -LiteralPath 'src\components\RestoreModal.svelte' -Value $restore -Encoding utf8

$note = @'
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
'@
Set-Content -LiteralPath 'src\components\NoteModal.svelte' -Value $note -Encoding utf8

$prestart = @'
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
'@
Set-Content -LiteralPath 'src\components\PrestartModal.svelte' -Value $prestart -Encoding utf8

foreach ($ignore in @(
  'src-tauri/icons/64x64.png',
  'src-tauri/icons/icon.png',
  'src-tauri/icons/StoreLogo.png',
  'src-tauri/icons/android/',
  'src-tauri/icons/ios/'
)) {
  if (-not (Select-String -Path .gitignore -SimpleMatch $ignore -Quiet)) {
    Add-Content .gitignore $ignore
  }
}
