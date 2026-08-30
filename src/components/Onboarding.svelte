<script lang="ts">
  import { ChevronRight, MonitorUp, Sparkles, SquareTerminal, PanelBottom, X } from '@lucide/svelte';
  import { enable as enableAutostart } from '@tauri-apps/plugin-autostart';
  import Glass from './Glass.svelte';

  let { onfinish, onInstallBrowser } = $props<{
    onfinish: () => void;
    onInstallBrowser: () => void;
  }>();

  let step = $state(0);
  let startWithWindows = $state(true);

  async function finish() {
    if (startWithWindows) {
      try { await enableAutostart(); } catch { /* surfaced later by System Health */ }
    }
    onfinish();
  }
</script>

<div class="modal-backdrop onboarding-backdrop">
  <div class="onboarding-shell">
    <Glass radius={26} frost={0.15}>
      <div class="onboarding-card">
        <div class="onboarding-progress"><span class:active={step >= 0}></span><span class:active={step >= 1}></span><span class:active={step >= 2}></span></div>
        {#if step === 0}
          <div class="onboarding-visual"><Sparkles size={31}/></div>
          <span class="section-kicker">Welcome</span>
          <h1>Keep your entire workspace in reach.</h1>
          <p>Context Capsule remembers the applications, browser tabs, editors, terminals, Git state and restartable services that make up your working context.</p>
          <button class="primary-button onboarding-next" onclick={() => step = 1}>Continue <ChevronRight size={16}/></button>
        {:else if step === 1}
          <div class="onboarding-visual"><PanelBottom size={31}/></div>
          <span class="section-kicker">Tray first</span>
          <h1>One click from the taskbar.</h1>
          <p>Context Capsule stays out of the way. Click its tray icon whenever you want to save where you are or restore a capsule.</p>
          <label class="onboarding-toggle"><input type="checkbox" bind:checked={startWithWindows}/><div><strong>Start with Windows</strong><span>Keep the tray control available after sign-in.</span></div></label>
          <button class="primary-button onboarding-next" onclick={() => step = 2}>Continue <ChevronRight size={16}/></button>
        {:else}
          <div class="onboarding-visual"><MonitorUp size={31}/></div>
          <span class="section-kicker">Integrations</span>
          <h1>Connect the workspace around you.</h1>
          <p>The desktop app already includes the CLI and native-host binaries. Install the Firefox/Zen host now; the extension itself can be loaded from the Context Capsule Browser Extension.</p>
          <button class="integration-button" onclick={onInstallBrowser}><SquareTerminal size={18}/><div><strong>Set up Firefox / Zen native host</strong><span>Uses the bundled, verified native host.</span></div><ChevronRight size={16}/></button>
          <div class="onboarding-actions"><button class="secondary-button" onclick={finish}>Finish setup</button></div>
        {/if}
        <button class="onboarding-skip" title="Skip onboarding" onclick={finish}><X size={14}/></button>
      </div>
    </Glass>
  </div>
</div>
