# Context Capsule Desktop

Tray-first Windows desktop control surface for [Context Capsule CLI](https://github.com/Context-Capsule/Capsule-CLI), built with **Tauri 2 + Svelte 5**.

The desktop app is intentionally a thin client. Capture, restore, persistence, history, semantic diffing, browser/editor integration, terminal/service handling, and diagnostics are engine responsibilities owned by the CLI repository. This repository owns the Windows desktop experience and the safe Tauri boundary used to expose those engine capabilities to the UI.

## Context Capsule ecosystem

Context Capsule is split across four cooperating repositories:

```text
                         user-facing clients

  +----------------------+                 +----------------------+
  | Capsule Desktop App  |                 | Capsule CLI          |
  | Tauri 2 + Svelte 5   |                 | Rust command client  |
  +----------+-----------+                 +----------+-----------+
             | whitelisted Tauri invoke               |
             | + bundled CLI sidecars                 | authenticated
             v                                        | loopback IPC
  +----------------------+                             v
  | Tauri Rust backend   |                    +--------------------+
  | src-tauri/src/lib.rs |------------------->| Local Agent        |
  +----------------------+   capsule commands | + worker/engines   |
                                                  |   |        |
                         runtime snapshots/bus     |   |        | native messaging
                                                  |   |        |
               +----------------------------------+   |        +------------------+
               |                                      |                           |
               v                                      v                           v
  +---------------------------+          +---------------------------+  +-------------------+
  | Capsule VS Code Extension |          | Capsule Browser Extension |  | SQLite/local state|
  | VS Code semantic adapter  |          | Firefox/Zen + Chrome      |  | history, revisions|
  +---------------------------+          +---------------------------+  +-------------------+
```

### Repository responsibilities

| Repository | Owns | Does not own |
| --- | --- | --- |
| **Capsule-CLI** | Core capture/restore engine, Local Agent, SQLite/revisions, desktop/window discovery, terminals, Docker, browser native hosts, desktop JSON API | Desktop GUI presentation, browser WebExtension UI/logic, VS Code API integration |
| **Capsule-Desktop-App** | Tray/full-app UX, Svelte UI, Tauri command allow-list, packaging the CLI runtime, desktop onboarding/settings | Capture/restore algorithms or persistence schemas |
| **Capsule-Browser-Extension** | Browser semantic capture/restore, shared Firefox/Zen + Chrome WebExtension logic, popup UX, native-messaging client protocol | Native-host executable/registration or capsule persistence |
| **Capsule-VSCode-Extension** | VS Code semantic capture/restore, editor/terminal state, extension-host targeting, restore-bus consumer | Capsule database, generic terminals, desktop windows, browser state |

## Where should a feature be implemented?

Use this table before opening a PR. Cross-repo features should keep each responsibility in its existing layer rather than moving engine behavior into a UI adapter.

| Feature or change | Primary repository | Typical follow-up |
| --- | --- | --- |
| New capsule command, storage field, revision behavior, capture/restore engine behavior | `Capsule-CLI` | Update Desktop only if the feature needs GUI exposure; update adapters if their protocol/schema changes |
| Desktop page, modal, tray behavior, onboarding, settings UI | `Capsule-Desktop-App` | Add/extend a CLI desktop API command only if new engine data is required |
| New Tauri operation or native desktop-only capability | `Capsule-Desktop-App` (`src-tauri`) | Keep the operation allow-listed; avoid arbitrary shell execution |
| Firefox/Zen or Chrome tab/window/group behavior | `Capsule-Browser-Extension` | Change CLI native-host protocol/storage only when the adapter contract changes |
| Browser native-host install/doctor/runtime file behavior | `Capsule-CLI` | Browser extension may need a matching protocol change |
| VS Code tabs, workspaces, selections, integrated-terminal semantics | `Capsule-VSCode-Extension` | CLI only if persisted schema/restore routing changes |
| Generic terminals, services, Docker, Windows apps/windows, Explorer, display placement | `Capsule-CLI` | Desktop may expose controls/results but should not reimplement behavior |
| A feature visible in all clients | Start in `Capsule-CLI` if it changes domain behavior | Then add thin UI/adapter integrations in the relevant repos |

A useful rule: **if the behavior must also work from `capsule ...` without the desktop app running, it belongs in the CLI engine first.**

## Desktop repository architecture

```text
Capsule-Desktop-App/
├─ src/
│  ├─ App.svelte                 application/window shell
│  ├─ components/                user-facing screens and reusable UI
│  │  ├─ QuickPanel.svelte       compact tray panel
│  │  ├─ FullApp.svelte          full desktop application
│  │  ├─ SaveModal.svelte        save/update UX
│  │  ├─ RestoreModal.svelte     restore UX/service decisions
│  │  ├─ Onboarding.svelte       first-run/integration setup
│  │  └─ ...
│  ├─ lib/
│  │  ├─ bridge.ts               typed frontend -> Tauri invocation layer
│  │  ├─ types.ts                desktop API/UI data contracts
│  │  └─ format.ts               presentation helpers
│  ├─ main.ts                    frontend bootstrap
│  └─ *.css                      visual system/responsive overrides
├─ src-tauri/
│  ├─ src/lib.rs                 native backend, command allow-list, sidecar execution,
│  │                             tray/window lifecycle and desktop operations
│  ├─ src/main.rs                Tauri entry point
│  ├─ capabilities/default.json  Tauri capabilities
│  └─ tauri.conf.json            packaging/window/bundle configuration
├─ scripts/
│  ├─ prepare-sidecar.mjs        locates/validates CLI runtime binaries for Tauri
│  ├─ prepare-branding.mjs       prepares bundle branding
│  └─ ...                        validation/capture helpers
├─ tests/                        Node-based source/regression tests
├─ package.json                  frontend/Tauri development scripts
└─ vite.config.ts                Vite/Svelte build configuration
```

### Frontend boundary

The Svelte frontend should remain presentation-oriented:

1. Components gather user intent.
2. `src/lib/bridge.ts` invokes a named Tauri command.
3. The Rust backend validates the request and maps it to a closed Context Capsule operation.
4. Engine behavior executes through the bundled CLI runtime.
5. Structured data is returned to the UI.

Do not add general shell/process execution to the webview. If a new engine operation is needed, add it to the CLI first, expose a stable machine-readable contract, then add a narrow Tauri command for it.

### CLI desktop API

The CLI currently exposes machine-readable desktop reads such as:

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

Responses use a versioned JSON envelope with `api_version`, `ok`, and either `data` or `error`. The desktop verifies the contract at startup.

Mutations intentionally continue through the mature CLI/worker transaction paths. For example, Save uses `save --cli-force`, while desktop Update uses same-name forced save semantics so a new immutable revision is produced through the engine rather than through GUI-owned persistence code.

## How the other adapters connect

### Browser extension

The browser WebExtension lives in [Capsule-Browser-Extension](https://github.com/Context-Capsule/Capsule-Browser-Extension). Firefox/Zen and Chrome talk to separate native-host executables supplied by the CLI repository:

```text
Firefox/Zen extension -> com.contextcapsule.host   -> capsule-firefox-host
Chrome extension      -> com.contextcapsule.chrome -> capsule-chrome-host
```

The desktop bundle includes those host executables and can install/verify native-host registration from onboarding or settings/system-health flows. Browser capture/restore logic itself belongs in the browser repository.

### VS Code extension

The VS Code adapter lives in [Capsule-VSCode-Extension](https://github.com/Context-Capsule/Capsule-VSCode-Extension). It continuously writes semantic editor state into the Context Capsule runtime directory and consumes CLI restore requests through the local restore bus. The Desktop app does not communicate directly with the extension.

## User workflow

From the desktop app a user can:

- open the compact Quick Panel from the tray;
- save the current workspace with a name and optional continuation note;
- restore recent capsules without remembering CLI syntax;
- choose restart behavior for saved terminal services;
- open the full application for capsule details, revision history, semantic diffs, Live Workspace, service settings, diagnostics, integrations, and preferences;
- configure browser native-host integration;
- launch automatically with Windows in tray-first mode.

Manual launches open the full app; autostart is tray-oriented.

## Development setup

### Requirements

For the complete Windows-native feature set:

- Windows 10/11
- Rust stable toolchain
- Node.js 22+
- npm
- WebView2 (normally present on supported Windows installations)

### Recommended checkout layout

Keep the CLI and desktop repositories next to each other:

```text
Context-Capsule/
├─ Capsule-CLI/
└─ Capsule-Desktop-App/
```

The desktop build packages CLI binaries as Tauri sidecars, so a sibling checkout is the simplest development setup.

### 1. Build the CLI runtime

```powershell
cd Capsule-CLI
cargo build --release --bins
```

The desktop package expects the Context Capsule runtime binaries, including:

```text
capsule.exe
capsule-agent-worker.exe
capsule-firefox-host.exe
capsule-chrome-host.exe
```

You can point sidecar preparation at a particular CLI build when needed:

```powershell
$env:CAPSULE_CLI_BIN = "C:\path\to\Capsule-CLI\target\release\capsule.exe"
```

### 2. Install desktop dependencies

```powershell
cd ..\Capsule-Desktop-App
npm ci
```

### 3. Run the web frontend only

Useful for layout work that does not require native operations:

```powershell
npm run dev
```

### 4. Run the full Tauri app

```powershell
npm run tauri:dev
```

This generates application icons, prepares branding and validates/prepares the CLI sidecars before starting Tauri + Vite.

## Build and package

Build the web layer:

```powershell
npm run build
```

Build the native desktop bundle/installer:

```powershell
npm run tauri:build
```

`tauri:build` runs icon, branding and sidecar preparation before Tauri packaging. Packaging should fail rather than silently producing an installer with missing Context Capsule runtime binaries.

## Validation

Run frontend/source checks:

```powershell
npm test
npm run check
npm run build
```

Run native Rust checks:

```powershell
cargo test --manifest-path src-tauri\Cargo.toml
cargo check --manifest-path src-tauri\Cargo.toml --all-targets
```

For a change that crosses the CLI/Desktop boundary, also run the relevant CLI tests/build in `Capsule-CLI` and manually exercise the changed desktop operation through `npm run tauri:dev`.

## Coordinating a cross-repo feature

A typical engine-backed desktop feature should be developed in this order:

1. **CLI:** define the domain behavior and tests.
2. **CLI:** expose or extend a stable machine-readable desktop API/mutation contract.
3. **Desktop Rust:** add a narrow allow-listed Tauri command if needed.
4. **Desktop TypeScript:** update `src/lib/types.ts` and `src/lib/bridge.ts`.
5. **Desktop Svelte:** implement the UI in `src/components/`.
6. **Validate both repositories together.**

If the feature also affects VS Code or browser semantics, update those adapters separately and treat their runtime/native-message shape as an explicit integration contract.

## Diagnostics

Desktop operations log to:

```text
%LOCALAPPDATA%\ContextCapsule\logs\desktop-app.log
```

The full app can open Context Capsule component logs from Settings/System Health. Operations receive unique IDs and log their start, selected workspace CWD, completion state, and relevant failure information.

When behavior is uncertain, diagnose the engine/adapter boundary before moving logic into the desktop layer.

## Security invariants

- The Svelte webview has no general shell capability.
- Desktop reads are allow-listed and versioned.
- Mutations are represented by a closed native operation set.
- Browser native-host installation uses bundled Context Capsule host executables.
- Temporary service-decision files use the CLI's existing worker contract and are removed after use.
- The UI only opens Context Capsule-owned log files through approved native operations.

These boundaries are part of the architecture. A convenience feature should not bypass them.