# Context Capsule Desktop

Tray-first Windows desktop control surface for [Context Capsule CLI](https://github.com/Context-Capsule/Capsule-CLI), built with **Tauri 2 + Svelte 5**.

The desktop app intentionally stays thin: capture, restore, terminal-service handling, browser/editor integration, persistence, history, diffing, and diagnostics remain owned by the Rust CLI engine. The GUI adds a user-friendly system-tray experience over those proven capabilities rather than reimplementing them.

## Product experience

- Click the Context Capsule tray icon to open the compact Quick Panel.
- Save the current workspace with a name and optional continuation note.
- Restore recent capsules without remembering CLI commands.
- Choose restart behavior for saved terminal services (`Once`, `Always`, or `Skip`).
- Open the full app for capsule details, immutable revision history, semantic diffs, Live Workspace, service policy/pre-start configuration, System Health, logs, integrations, and settings.
- Manual launches open the full app. Windows autostart launches tray-only.

The visual system is dark obsidian with a neon-yellow accent and liquid-glass surfaces. The optical effect uses the existing [`simple-liquid-glass`](https://github.com/lucaperullo/simple-liquid-glass) web component rather than a custom refraction implementation.

## Architecture

```text
Windows tray / Svelte UI
          │
          │ whitelisted Tauri invoke commands
          ▼
Tauri Rust desktop backend
          │
          ├─ side-effect-free `capsule desktop ...` JSON API
          │
          └─ validated operations through bundled Context Capsule binaries
                    │
                    ├─ capsule.exe
                    ├─ capsule-agent-worker.exe
                    ├─ capsule-firefox-host.exe
                    └─ capsule-chrome-host.exe
```

The frontend has **no arbitrary shell permission**. All process execution lives in Rust and is limited to explicit Context Capsule operations.

### Desktop API

The CLI exposes a versioned, side-effect-free machine API:

```text
capsule desktop contract
capsule desktop overview
capsule desktop capsule <name[@revision]>
capsule desktop history <name>
capsule desktop diff <before> <after>
capsule desktop live
capsule desktop health
capsule desktop services <name[@revision]>
capsule desktop log-paths
```

Responses are JSON envelopes with an `api_version`, `ok`, and either `data` or `error`. The desktop app verifies the contract at startup.

Mutations continue to use the existing CLI/worker transaction paths. In particular:

- Save uses `save --cli-force`.
- Desktop Update is a same-name `save --force --cli-force`, preserving the capsule's ignored-app list, so restartable-service metadata is refreshed safely for the new revision.
- GUI service decisions use the existing `CONTEXT_CAPSULE_SERVICE_DECISIONS_PATH` worker contract instead of pretending a GUI pipe is an interactive terminal.
- Save/Update choose a trustworthy active local project directory before invoking the CLI so Git/tool context is not captured from the installed app directory.

## Browser integration

The browser extension is maintained in:

**https://github.com/Context-Capsule/Capsule-Browser-Extension**

The desktop bundle contains the Firefox/Zen and Chrome native-host executables and can install their native-host registration from onboarding or System Health/Settings.

## Development

### Requirements

- Windows 10/11 for the complete native feature set
- Rust stable
- Node.js 22+
- npm
- WebView2 (normally present on supported Windows installations)

### 1. Build the CLI runtime

During development, keep the repositories next to each other:

```text
Context-Capsule/
  Capsule-CLI/
  Capsule-Desktop-App/
```

On the CLI desktop-integration branch:

```powershell
cd ..\Capsule-CLI
git switch feature/desktop-app-api-20260830
cargo build --release --bins
```

The desktop app deliberately requires all four runtime binaries. Packaging fails instead of silently producing an incomplete app if one is missing.

You may alternatively point the preparation script at a built `capsule.exe`:

```powershell
$env:CAPSULE_CLI_BIN = "C:\path\to\Capsule-CLI\target\release\capsule.exe"
```

### 2. Install frontend dependencies

```powershell
cd ..\Capsule-Desktop-App
npm install
```

### 3. Run the desktop app

```powershell
npm run tauri:dev
```

`tauri:dev` first generates platform application icons from the checked-in `src-tauri/icons/icon.svg`, then prepares target-triple sidecars and starts Tauri/Vite. The SVG is the single source of truth for branding; generated PNG/ICO/ICNS assets are ignored by Git.

### 4. Build an installer

```powershell
npm run tauri:build
```

`tauri:build` regenerates platform icons and requires real release CLI binaries. It refuses to package placeholders or a partial CLI runtime.

## Validation

Fast local/source checks:

```powershell
npm test
npm run check
npm run build
```

Native Rust checks:

```powershell
cargo test --manifest-path src-tauri\Cargo.toml
cargo check --manifest-path src-tauri\Cargo.toml --all-targets
```

The repository also has a Windows validation workflow pinned to the self-hosted **POTUS** runner. It intentionally validates this desktop repository without reaching into another private repository using the repository-scoped `GITHUB_TOKEN`. CLI native validation runs in the CLI repository; desktop CI validates the GUI/backend contract and packaging surface separately.

## Diagnostics

Desktop operations log to a bounded rotating file:

```text
%LOCALAPPDATA%\ContextCapsule\logs\desktop-app.log
```

The full app's Settings page can open Context Capsule component logs. Operations receive unique IDs and log their start, selected workspace CWD, completion state, and relevant failure information.

When behavior is uncertain, add/inspect diagnostics before changing engine behavior.

## Security notes

- No general shell capability is exposed to the Svelte webview.
- Desktop reads are allow-listed and versioned.
- Mutations are represented by a closed Rust enum.
- Restore decision files are temporary, use the CLI's existing schema, and are deleted after the worker exits.
- The UI can only open `.log` files inside Context Capsule's own log directory.
- Browser native-host installation uses bundled Context Capsule host executables only.

## Branches used during initial integration

- Desktop: `feature/tauri-desktop-app-20260830`
- CLI API: `feature/desktop-app-api-20260830`

Merge both only after their validation passes and review.
