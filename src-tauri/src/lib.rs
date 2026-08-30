use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    env, fs,
    io::Write,
    path::PathBuf,
    sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{
    AppHandle, Emitter, Manager, Runtime, State, WindowEvent,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_positioner::{Position, WindowExt};
use tauri_plugin_shell::{
    ShellExt,
    process::{CommandChild, CommandEvent},
};

const DESKTOP_API_VERSION: u32 = 1;
const SERVICE_DECISIONS_ENV: &str = "CONTEXT_CAPSULE_SERVICE_DECISIONS_PATH";
const CALLER_PID_ENV: &str = "CONTEXT_CAPSULE_CALLER_PID";
const MAX_LOG_BYTES: u64 = 1024 * 1024;
const MAX_CAPTURED_OUTPUT: usize = 4 * 1024 * 1024;
static OPERATION_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Deserialize)]
struct DesktopEnvelope {
    api_version: u32,
    ok: bool,
    data: Option<Value>,
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OperationDecision {
    service_index: u32,
    decision: DecisionKind,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum DecisionKind {
    Once,
    Always,
    Skip,
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
enum OperationRequest {
    Save {
        name: String,
        note: Option<String>,
        #[serde(default)]
        ignore_apps: Vec<String>,
    },
    Update {
        name: String,
        #[serde(default)]
        ignore_apps: Vec<String>,
    },
    Restore {
        reference: String,
        #[serde(default)]
        replace: bool,
        #[serde(default)]
        only: Vec<String>,
        #[serde(default)]
        decisions: Vec<OperationDecision>,
    },
    Delete {
        name: String,
    },
    Note {
        reference: String,
        message: String,
    },
    ServicePolicy {
        reference: String,
        service_index: u32,
        policy: String,
    },
    ServicePrestart {
        reference: String,
        service_index: u32,
        command: Option<String>,
    },
    InstallBrowserHost {
        browser: String,
    },
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct OperationEvent {
    operation_id: String,
    stream: &'static str,
    text: String,
    phase: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OperationResult {
    operation_id: String,
    code: i32,
    success: bool,
    cancelled: bool,
    stdout: String,
    stderr: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TrayAction {
    action: &'static str,
    nonce: u64,
}

struct ActiveOperation {
    child: CommandChild,
    save_name: Option<String>,
    save_existed: bool,
}

#[derive(Default)]
struct ActiveOperations {
    children: Mutex<HashMap<String, ActiveOperation>>,
    cancelled: Mutex<HashSet<String>>,
}

#[tauri::command]
async fn query_desktop(app: AppHandle, action: String, args: Vec<String>) -> Result<Value, String> {
    let mut value = desktop_api_call(&app, &action, &args).await?;
    if action == "log-paths" {
        if let Some(object) = value.as_object_mut() {
            if let Ok(directory) = app_log_directory() {
                object.insert(
                    "desktop-app".to_owned(),
                    json!(directory.join("desktop-app.log").to_string_lossy()),
                );
            }
        }
    }
    Ok(value)
}

async fn desktop_api_call(app: &AppHandle, action: &str, args: &[String]) -> Result<Value, String> {
    let allowed = match action {
        "contract" | "overview" | "live" | "health" | "log-paths" => args.is_empty(),
        "capsule" | "history" | "services" => args.len() == 1,
        "diff" => args.len() == 2,
        _ => false,
    };
    if !allowed {
        return Err("desktop API request is not allowed".to_owned());
    }

    let mut command_args = vec!["desktop".to_owned(), action.to_owned()];
    command_args.extend(args.iter().cloned());
    append_app_log(format!(
        "query action={action} args={:?}",
        &command_args[2..]
    ));

    let output = app
        .shell()
        .sidecar("capsule")
        .map_err(|error| format!("Context Capsule sidecar is unavailable: {error}"))?
        .args(command_args)
        .output()
        .await
        .map_err(|error| format!("desktop API process failed: {error}"))?;

    let stdout = bounded_text(output.stdout);
    let stderr = bounded_text(output.stderr);
    let envelope: DesktopEnvelope = serde_json::from_str(stdout.trim()).map_err(|error| {
        append_app_log(format!(
            "query action={action} invalid-json error={error} stderr={stderr:?}"
        ));
        format!("Context Capsule returned invalid desktop API JSON: {error}")
    })?;
    if envelope.api_version != DESKTOP_API_VERSION {
        return Err(format!(
            "Desktop API mismatch: app expects {}, CLI provides {}",
            DESKTOP_API_VERSION, envelope.api_version
        ));
    }
    if !envelope.ok {
        return Err(envelope
            .error
            .unwrap_or_else(|| "Context Capsule desktop API request failed".to_owned()));
    }
    envelope
        .data
        .ok_or_else(|| "desktop API response did not contain data".to_owned())
}

async fn capsule_exists(app: &AppHandle, name: &str) -> Result<bool, String> {
    let overview = desktop_api_call(app, "overview", &[]).await?;
    Ok(overview
        .get("capsules")
        .and_then(Value::as_array)
        .is_some_and(|capsules| {
            capsules.iter().any(|capsule| {
                capsule
                    .get("name")
                    .and_then(Value::as_str)
                    .is_some_and(|value| value.eq_ignore_ascii_case(name))
            })
        }))
}

#[tauri::command]
async fn run_operation(
    app: AppHandle,
    active: State<'_, ActiveOperations>,
    request: OperationRequest,
) -> Result<OperationResult, String> {
    let operation_id = next_operation_id();
    let (program, args) = operation_command(&request)?;
    let decision_file = write_restore_decision_file(&request, &operation_id)?;
    let working_directory = preferred_operation_directory(&app, &request).await;
    let save_name = match &request {
        OperationRequest::Save { name, .. } => Some(name.clone()),
        _ => None,
    };
    let save_existed = match save_name.as_deref() {
        Some(name) => capsule_exists(&app, name).await.unwrap_or(true),
        None => false,
    };
    append_app_log(format!(
        "operation.begin id={operation_id} program={program} args={args:?} decision_file={} save_existed={save_existed}",
        decision_file.is_some()
    ));
    emit_operation(
        &app,
        &operation_id,
        "status",
        "Operation started",
        "Preparing",
    );

    let mut command = app
        .shell()
        .sidecar(program)
        .map_err(|error| {
            format!("required Context Capsule sidecar '{program}' is unavailable: {error}")
        })?
        .args(args);
    if matches!(
        request,
        OperationRequest::Save { .. } | OperationRequest::Update { .. }
    ) {
        // The GUI invokes the mature worker directly for save/update. Passing
        // the desktop PID lets --cli-force walk the real process ancestry and
        // exclude the terminal that launched `tauri dev`, exactly like a manual
        // CLI invocation excludes its own shell. This prevents the desktop app
        // from trying to Ctrl+C the development terminal that is hosting it.
        command = command.env(CALLER_PID_ENV, std::process::id().to_string());
    }
    if let Some(path) = working_directory.as_ref() {
        append_app_log(format!("operation.cwd id={operation_id} path={:?}", path));
        command = command.current_dir(path);
    }
    if let Some(path) = decision_file.as_ref() {
        command = command.env(SERVICE_DECISIONS_ENV, path.to_string_lossy().to_string());
    }
    let (mut rx, child) = command.spawn().map_err(|error| {
        if let Some(path) = decision_file.as_ref() {
            let _ = fs::remove_file(path);
        }
        format!("could not start Context Capsule operation: {error}")
    })?;

    active
        .children
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(
            operation_id.clone(),
            ActiveOperation {
                child,
                save_name,
                save_existed,
            },
        );

    let mut stdout = String::new();
    let mut stderr = String::new();
    let mut code = 1;

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(bytes) => {
                let text = String::from_utf8_lossy(&bytes).into_owned();
                push_bounded(&mut stdout, &text);
                let phase = phase_for_line(&text);
                emit_operation(&app, &operation_id, "stdout", text.trim(), phase);
            }
            CommandEvent::Stderr(bytes) => {
                let text = String::from_utf8_lossy(&bytes).into_owned();
                push_bounded(&mut stderr, &text);
                let phase = phase_for_line(&text);
                emit_operation(&app, &operation_id, "stderr", text.trim(), phase);
            }
            CommandEvent::Error(error) => {
                push_bounded(&mut stderr, &error);
                emit_operation(
                    &app,
                    &operation_id,
                    "stderr",
                    &error,
                    "Action needs attention",
                );
            }
            CommandEvent::Terminated(payload) => {
                code = payload.code.unwrap_or(1);
            }
            _ => {}
        }
    }

    active
        .children
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .remove(&operation_id);
    let cancelled = active
        .cancelled
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .remove(&operation_id);

    if let Some(path) = decision_file.as_ref() {
        let _ = fs::remove_file(path);
    }
    if cancelled {
        code = 130;
        push_bounded(&mut stderr, "Operation cancelled by user");
    }
    let success = code == 0 && !cancelled;
    append_app_log(format!(
        "operation.complete id={operation_id} success={success} cancelled={cancelled} code={code} stderr_tail={:?}",
        stderr.lines().rev().take(3).collect::<Vec<_>>()
    ));
    Ok(OperationResult {
        operation_id,
        code,
        success,
        cancelled,
        stdout,
        stderr,
    })
}

#[tauri::command]
async fn cancel_operation(
    app: AppHandle,
    active: State<'_, ActiveOperations>,
    operation_id: String,
) -> Result<(), String> {
    let operation = active
        .children
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .remove(&operation_id)
        .ok_or_else(|| "operation is no longer running".to_owned())?;

    active
        .cancelled
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(operation_id.clone());

    let cleanup_name = operation
        .save_name
        .clone()
        .filter(|_| !operation.save_existed);
    operation
        .child
        .kill()
        .map_err(|error| format!("could not cancel Context Capsule operation: {error}"))?;
    append_app_log(format!("operation.cancel id={operation_id}"));
    emit_operation(
        &app,
        &operation_id,
        "status",
        "Cancellation requested",
        "Cancelling",
    );

    // Save without --force can only create a new capsule. If cancellation races
    // the final SQLite commit, remove that new capsule after the worker is
    // terminated. Existing capsules are never deleted by this cleanup path.
    if let Some(name) = cleanup_name {
        thread::sleep(Duration::from_millis(180));
        match app.shell().sidecar("capsule-agent-worker") {
            Ok(command) => {
                let output = command.args(["delete", &name]).output().await;
                append_app_log(format!(
                    "operation.cancel cleanup id={operation_id} capsule={name:?} result={:?}",
                    output.as_ref().map(|value| value.status.code())
                ));
            }
            Err(error) => append_app_log(format!(
                "operation.cancel cleanup id={operation_id} capsule={name:?} sidecar-error={error}"
            )),
        }
    }
    Ok(())
}

fn operation_command(request: &OperationRequest) -> Result<(&'static str, Vec<String>), String> {
    let mut args = Vec::new();
    let program = match request {
        OperationRequest::Save {
            name,
            note,
            ignore_apps,
        } => {
            require_nonempty("capsule name", name)?;
            args.extend(["save".to_owned(), name.clone(), "--cli-force".to_owned()]);
            if let Some(note) = note.as_deref().filter(|note| !note.trim().is_empty()) {
                args.extend(["--message".to_owned(), note.to_owned()]);
            }
            for app in ignore_apps.iter().filter(|app| !app.trim().is_empty()) {
                args.extend(["--ignore-app".to_owned(), app.trim().to_owned()]);
            }
            "capsule-agent-worker"
        }
        OperationRequest::Update { name, ignore_apps } => {
            require_nonempty("capsule name", name)?;
            args.extend([
                "save".to_owned(),
                name.clone(),
                "--force".to_owned(),
                "--cli-force".to_owned(),
            ]);
            for app in ignore_apps.iter().filter(|app| !app.trim().is_empty()) {
                args.extend(["--ignore-app".to_owned(), app.trim().to_owned()]);
            }
            "capsule-agent-worker"
        }
        OperationRequest::Restore {
            reference,
            replace,
            only,
            decisions,
        } => {
            require_nonempty("capsule reference", reference)?;
            args.extend(["restore".to_owned(), reference.clone()]);
            if *replace {
                args.push("--replace".to_owned());
            }
            for selector in only.iter().filter(|value| !value.trim().is_empty()) {
                args.extend(["--only".to_owned(), selector.trim().to_owned()]);
            }
            let _ = decisions;
            "capsule-agent-worker"
        }
        OperationRequest::Delete { name } => {
            require_nonempty("capsule name", name)?;
            args.extend(["delete".to_owned(), name.clone()]);
            "capsule"
        }
        OperationRequest::Note { reference, message } => {
            require_nonempty("capsule reference", reference)?;
            require_nonempty("note", message)?;
            args.extend([
                "note".to_owned(),
                reference.clone(),
                "--message".to_owned(),
                message.clone(),
            ]);
            "capsule"
        }
        OperationRequest::ServicePolicy {
            reference,
            service_index,
            policy,
        } => {
            require_nonempty("capsule reference", reference)?;
            if !matches!(policy.as_str(), "ask" | "always") {
                return Err("service policy must be 'ask' or 'always'".to_owned());
            }
            args.extend([
                "service".to_owned(),
                "policy".to_owned(),
                reference.clone(),
                service_index.to_string(),
                policy.clone(),
            ]);
            "capsule"
        }
        OperationRequest::ServicePrestart {
            reference,
            service_index,
            command,
        } => {
            require_nonempty("capsule reference", reference)?;
            args.extend([
                "service".to_owned(),
                "prestart".to_owned(),
                reference.clone(),
                service_index.to_string(),
            ]);
            match command
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                Some(command) => args.extend(["--command".to_owned(), command.to_owned()]),
                None => args.push("--clear".to_owned()),
            }
            "capsule"
        }
        OperationRequest::InstallBrowserHost { browser } => match browser.as_str() {
            "firefox" => {
                args.push("--install".to_owned());
                "capsule-firefox-host"
            }
            "chrome" => {
                args.push("--install".to_owned());
                "capsule-chrome-host"
            }
            _ => return Err("browser must be 'firefox' or 'chrome'".to_owned()),
        },
    };
    Ok((program, args))
}

async fn preferred_operation_directory(
    app: &AppHandle,
    request: &OperationRequest,
) -> Option<PathBuf> {
    if !matches!(
        request,
        OperationRequest::Save { .. } | OperationRequest::Update { .. }
    ) {
        return None;
    }
    let live = match desktop_api_call(app, "live", &[]).await {
        Ok(value) => value,
        Err(error) => {
            append_app_log(format!("operation.cwd live-discovery unavailable: {error}"));
            return None;
        }
    };

    let sessions = live
        .pointer("/terminals/sessions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    for session in sessions
        .iter()
        .filter(|session| !session["foreground_command"].is_null())
    {
        if let Some(path) = existing_local_directory(session.get("working_directory")) {
            return Some(path);
        }
    }

    if let Some(folders) = live
        .pointer("/editor/workspaceFolders")
        .and_then(Value::as_array)
    {
        for folder in folders {
            if let Some(uri) = folder.get("uri").and_then(Value::as_str) {
                if let Some(path) = local_file_uri_path(uri).filter(|path| path.is_dir()) {
                    return Some(path);
                }
            }
        }
    }

    for session in &sessions {
        if let Some(path) = existing_local_directory(session.get("working_directory")) {
            return Some(path);
        }
    }
    None
}

fn existing_local_directory(value: Option<&Value>) -> Option<PathBuf> {
    let path = PathBuf::from(value?.as_str()?.trim());
    path.is_dir().then_some(path)
}

fn local_file_uri_path(uri: &str) -> Option<PathBuf> {
    let value = uri.strip_prefix("file:///")?;
    let decoded = percent_decode(value)?;
    #[cfg(windows)]
    {
        return Some(PathBuf::from(decoded.replace('/', "\\")));
    }
    #[cfg(not(windows))]
    {
        return Some(PathBuf::from(format!("/{decoded}")));
    }
}

fn percent_decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0usize;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            if index + 2 >= bytes.len() {
                return None;
            }
            let high = hex_value(bytes[index + 1])?;
            let low = hex_value(bytes[index + 2])?;
            output.push((high << 4) | low);
            index += 3;
        } else {
            output.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(output).ok()
}

fn hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

fn write_restore_decision_file(
    request: &OperationRequest,
    operation_id: &str,
) -> Result<Option<PathBuf>, String> {
    let OperationRequest::Restore {
        reference,
        decisions,
        ..
    } = request
    else {
        return Ok(None);
    };
    if decisions.is_empty() {
        return Ok(None);
    }

    let (capsule_name, revision) = explicit_revision(reference).ok_or_else(|| {
        "desktop restore with service decisions requires an explicit capsule revision".to_owned()
    })?;
    let mut ordered = decisions.iter().collect::<Vec<_>>();
    ordered.sort_by_key(|decision| decision.service_index);
    let decisions = ordered
        .into_iter()
        .map(|decision| {
            json!({
                "service_index": decision.service_index,
                "decision": match decision.decision {
                    DecisionKind::Once => "start-once",
                    DecisionKind::Always => "always",
                    DecisionKind::Skip => "skip",
                }
            })
        })
        .collect::<Vec<_>>();
    let payload = json!({
        "capsule_name": capsule_name,
        "revision": revision,
        "decisions": decisions,
    });
    let path = env::temp_dir().join(format!(
        "context-capsule-desktop-service-decisions-{operation_id}.json"
    ));
    let bytes = serde_json::to_vec(&payload)
        .map_err(|error| format!("could not encode service restart decisions: {error}"))?;
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    let mut file = options
        .open(&path)
        .map_err(|error| format!("could not create service decision file: {error}"))?;
    file.write_all(&bytes)
        .map_err(|error| format!("could not write service decision file: {error}"))?;
    file.flush()
        .map_err(|error| format!("could not flush service decision file: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = file
            .metadata()
            .map_err(|error| format!("could not inspect service decision file: {error}"))?
            .permissions();
        permissions.set_mode(0o600);
        fs::set_permissions(&path, permissions)
            .map_err(|error| format!("could not secure service decision file: {error}"))?;
    }
    Ok(Some(path))
}

fn explicit_revision(reference: &str) -> Option<(String, u32)> {
    let (name, suffix) = reference.rsplit_once('@')?;
    if name.trim().is_empty() || suffix.is_empty() || !suffix.chars().all(|ch| ch.is_ascii_digit())
    {
        return None;
    }
    let revision = suffix.parse::<u32>().ok().filter(|value| *value > 0)?;
    Some((name.to_owned(), revision))
}

fn require_nonempty(label: &str, value: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        Err(format!("{label} cannot be empty"))
    } else {
        Ok(())
    }
}

#[tauri::command]
fn show_main_window(
    app: AppHandle,
    view: Option<String>,
    capsule: Option<String>,
) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window is unavailable".to_owned())?;
    window.show().map_err(|error| error.to_string())?;
    let _ = window.unminimize();
    window.set_focus().map_err(|error| error.to_string())?;
    if view.is_some() || capsule.is_some() {
        let _ = window.emit(
            "app-navigation",
            serde_json::json!({ "view": view, "capsule": capsule }),
        );
    }
    Ok(())
}

#[tauri::command]
fn hide_quick_panel(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("quick")
        .ok_or_else(|| "quick panel is unavailable".to_owned())?;
    window.hide().map_err(|error| error.to_string())
}

#[tauri::command]
fn quit_application(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn open_path(app: AppHandle, path: String) -> Result<(), String> {
    let requested = PathBuf::from(path);
    let logs = app_log_directory()?;
    let canonical_logs = fs::canonicalize(&logs).unwrap_or(logs);
    let canonical = fs::canonicalize(&requested)
        .map_err(|error| format!("log path is unavailable: {error}"))?;
    if !canonical.starts_with(&canonical_logs)
        || canonical.extension().and_then(|value| value.to_str()) != Some("log")
    {
        return Err("only Context Capsule log files can be opened from the desktop app".to_owned());
    }
    app.opener()
        .open_path(canonical.to_string_lossy().to_string(), None::<&str>)
        .map_err(|error| error.to_string())
}

fn phase_for_line(line: &str) -> &'static str {
    let line = line.to_ascii_lowercase();
    if line.contains("checking save prerequisites") {
        "Checking workspace"
    } else if line.contains("capturing running terminal") {
        "Capturing services"
    } else if line.contains("discovering workspace") {
        "Capturing workspace"
    } else if line.contains("saved capsule") {
        "Saving capsule"
    } else if line.contains("restoring capsule") {
        "Restoring workspace"
    } else if line.contains("desktop:") {
        "Restoring applications"
    } else if line.contains("starting approved saved services") {
        "Restarting services"
    } else if line.contains("started [") {
        "Verifying services"
    } else if line.contains("restore pass complete") {
        "Finishing restore"
    } else if line.contains("failed") || line.contains("error") {
        "Action needs attention"
    } else {
        "Working"
    }
}

fn emit_operation(app: &AppHandle, id: &str, stream: &'static str, text: &str, phase: &str) {
    let _ = app.emit(
        "operation-progress",
        OperationEvent {
            operation_id: id.to_owned(),
            stream,
            text: sanitize_line(text),
            phase: phase.to_owned(),
        },
    );
}

fn show_quick<R: Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window("quick") {
        let _ = window.move_window(Position::TrayCenter);
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn toggle_quick<R: Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window("quick") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.move_window(Position::TrayCenter);
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

fn setup_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Context Capsule", true, None::<&str>)?;
    let save = MenuItem::with_id(app, "save", "Save Current Workspace", true, None::<&str>)?;
    let restore = MenuItem::with_id(
        app,
        "restore-last",
        "Restore Last Capsule",
        true,
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &save, &restore, &separator, &quit])?;

    TrayIconBuilder::with_id("context-capsule")
        .icon(
            app.default_window_icon()
                .expect("application icon missing")
                .clone(),
        )
        .tooltip("Context Capsule")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => {
                let _ = show_main_window(app.clone(), None, None);
            }
            "save" => {
                show_quick(app);
                let _ = app.emit_to(
                    "quick",
                    "tray-action",
                    TrayAction {
                        action: "save",
                        nonce: next_nonce(),
                    },
                );
            }
            "restore-last" => {
                show_quick(app);
                let _ = app.emit_to(
                    "quick",
                    "tray-action",
                    TrayAction {
                        action: "restore-last",
                        nonce: next_nonce(),
                    },
                );
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event);
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                toggle_quick(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

pub fn run() {
    let builder = tauri::Builder::default()
        .manage(ActiveOperations::default())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if !args.iter().any(|arg| arg == "--autostart") {
                let _ = show_main_window(app.clone(), None, None);
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .invoke_handler(tauri::generate_handler![
            query_desktop,
            run_operation,
            cancel_operation,
            show_main_window,
            hide_quick_panel,
            quit_application,
            open_path
        ])
        .setup(|app| {
            setup_tray(app)?;
            let autostart = env::args().any(|arg| arg == "--autostart");
            append_app_log(format!("desktop.start autostart={autostart}"));
            if !autostart {
                let _ = show_main_window(app.handle().clone(), None, None);
            }
            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::Focused(false) if window.label() == "quick" => {
                let _ = window.hide();
            }
            WindowEvent::CloseRequested { api, .. }
                if matches!(window.label(), "quick" | "main") =>
            {
                api.prevent_close();
                let _ = window.hide();
            }
            _ => {}
        });

    builder
        .run(tauri::generate_context!())
        .expect("error while running Context Capsule desktop");
}

fn next_operation_id() -> String {
    format!(
        "op-{}-{}",
        now_unix_ms(),
        OPERATION_COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

fn next_nonce() -> u64 {
    OPERATION_COUNTER.fetch_add(1, Ordering::Relaxed)
}

fn now_unix_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn bounded_text(mut bytes: Vec<u8>) -> String {
    if bytes.len() > MAX_CAPTURED_OUTPUT {
        bytes.truncate(MAX_CAPTURED_OUTPUT);
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

fn push_bounded(target: &mut String, value: &str) {
    if target.len() >= MAX_CAPTURED_OUTPUT {
        return;
    }
    let remaining = MAX_CAPTURED_OUTPUT - target.len();
    let mut used = 0usize;
    for ch in value.chars() {
        let width = ch.len_utf8();
        if used.saturating_add(width) > remaining {
            break;
        }
        target.push(ch);
        used += width;
    }
    if target.len() < MAX_CAPTURED_OUTPUT {
        target.push('\n');
    }
}

fn sanitize_line(value: &str) -> String {
    value
        .chars()
        .take(4096)
        .map(|ch| {
            if ch.is_control() && ch != '\t' {
                ' '
            } else {
                ch
            }
        })
        .collect()
}

fn app_log_directory() -> Result<PathBuf, String> {
    if let Some(path) = env::var_os("CONTEXT_CAPSULE_LOG_DIR") {
        return Ok(PathBuf::from(path));
    }
    #[cfg(windows)]
    {
        let base =
            env::var_os("LOCALAPPDATA").ok_or_else(|| "LOCALAPPDATA is unavailable".to_owned())?;
        return Ok(PathBuf::from(base).join("ContextCapsule").join("logs"));
    }
    #[cfg(target_os = "macos")]
    {
        let home = env::var_os("HOME").ok_or_else(|| "HOME is unavailable".to_owned())?;
        return Ok(PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("ContextCapsule")
            .join("logs"));
    }
    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        if let Some(base) = env::var_os("XDG_STATE_HOME") {
            return Ok(PathBuf::from(base).join("context-capsule").join("logs"));
        }
        let home = env::var_os("HOME").ok_or_else(|| "HOME is unavailable".to_owned())?;
        Ok(PathBuf::from(home)
            .join(".local")
            .join("state")
            .join("context-capsule")
            .join("logs"))
    }
}

fn append_app_log(message: String) {
    let Ok(directory) = app_log_directory() else {
        return;
    };
    if fs::create_dir_all(&directory).is_err() {
        return;
    }
    let path = directory.join("desktop-app.log");
    let line = format!("{} [INFO] {}\n", now_unix_ms(), sanitize_line(&message));
    if fs::metadata(&path)
        .ok()
        .is_some_and(|metadata| metadata.len().saturating_add(line.len() as u64) > MAX_LOG_BYTES)
    {
        let rotated = directory.join("desktop-app.log.1");
        let _ = fs::remove_file(&rotated);
        let _ = fs::rename(&path, rotated);
    }
    if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = file.write_all(line.as_bytes());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn operation_phase_mapping_is_stable() {
        assert_eq!(
            phase_for_line("Discovering workspace for capsule 'demo'..."),
            "Capturing workspace"
        );
        assert_eq!(
            phase_for_line("Starting approved saved services..."),
            "Restarting services"
        );
        assert_eq!(phase_for_line("error: nope"), "Action needs attention");
    }

    #[test]
    fn service_policy_is_whitelisted() {
        let request = OperationRequest::ServicePolicy {
            reference: "demo".to_owned(),
            service_index: 1,
            policy: "ask".to_owned(),
        };
        let (_, args) = operation_command(&request).unwrap();
        assert_eq!(args, ["service", "policy", "demo", "1", "ask"]);
    }

    #[test]
    fn restore_decisions_use_worker_decision_file_contract() {
        let request = OperationRequest::Restore {
            reference: "demo".to_owned(),
            replace: false,
            only: vec![],
            decisions: vec![
                OperationDecision {
                    service_index: 1,
                    decision: DecisionKind::Once,
                },
                OperationDecision {
                    service_index: 2,
                    decision: DecisionKind::Skip,
                },
            ],
        };
        let (program, args) = operation_command(&request).unwrap();
        assert_eq!(program, "capsule-agent-worker");
        assert_eq!(args, ["restore", "demo"]);
    }

    #[test]
    fn save_uses_service_safe_worker_path() {
        let request = OperationRequest::Save {
            name: "demo".to_owned(),
            note: None,
            ignore_apps: vec![],
        };
        let (program, args) = operation_command(&request).unwrap();
        assert_eq!(program, "capsule-agent-worker");
        assert_eq!(args, ["save", "demo", "--cli-force"]);
    }

    #[test]
    fn update_uses_service_safe_cli_force_path() {
        let request = OperationRequest::Update {
            name: "demo".to_owned(),
            ignore_apps: vec!["Zen Browser".to_owned()],
        };
        let (program, args) = operation_command(&request).unwrap();
        assert_eq!(program, "capsule-agent-worker");
        assert_eq!(
            args,
            [
                "save",
                "demo",
                "--force",
                "--cli-force",
                "--ignore-app",
                "Zen Browser"
            ]
        );
    }

    #[test]
    fn local_file_uri_decoding_is_bounded_and_rejects_remote_schemes() {
        assert_eq!(
            percent_decode("C:/Work/My%20Project"),
            Some("C:/Work/My Project".to_owned())
        );
        assert!(local_file_uri_path("vscode-remote://wsl+Ubuntu/home/user/work").is_none());
        assert!(percent_decode("bad%2").is_none());
    }

    #[test]
    fn explicit_restore_revision_parser_is_strict() {
        assert_eq!(explicit_revision("demo@3"), Some(("demo".to_owned(), 3)));
        assert_eq!(explicit_revision("demo"), None);
        assert_eq!(explicit_revision("demo@0"), None);
        assert_eq!(explicit_revision("demo@latest"), None);
    }

    #[test]
    fn decision_file_matches_worker_schema_and_is_removed_by_test() {
        let request = OperationRequest::Restore {
            reference: "demo@4".to_owned(),
            replace: false,
            only: vec![],
            decisions: vec![
                OperationDecision {
                    service_index: 2,
                    decision: DecisionKind::Skip,
                },
                OperationDecision {
                    service_index: 1,
                    decision: DecisionKind::Once,
                },
            ],
        };
        let operation_id = format!("unit-test-{}", next_nonce());
        let path = write_restore_decision_file(&request, &operation_id)
            .unwrap()
            .unwrap();
        let value: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(value["capsule_name"], "demo");
        assert_eq!(value["revision"], 4);
        assert_eq!(value["decisions"][0]["service_index"], 1);
        assert_eq!(value["decisions"][0]["decision"], "start-once");
        assert_eq!(value["decisions"][1]["service_index"], 2);
        assert_eq!(value["decisions"][1]["decision"], "skip");
        let _ = fs::remove_file(path);
    }
}
