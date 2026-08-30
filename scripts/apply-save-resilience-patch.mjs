import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

async function ensureReplacement(path, before, after) {
  const absolute = resolve(root, path);
  // actions/checkout on POTUS may materialize CRLF even though the repository
  // stores LF. Normalize the in-memory worktree before exact guarded matching;
  // Git will normalize the written LF content back to the same index form.
  const source = (await readFile(absolute, 'utf8')).replace(/\r\n/g, '\n');
  if (source.includes(after)) {
    console.log(`already patched ${path}`);
    return;
  }
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${path}: neither the expected source nor patched form was found`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${path}: patch anchor is ambiguous`);
  }
  await writeFile(absolute, source.slice(0, first) + after + source.slice(first + before.length), 'utf8');
  console.log(`patched ${path}`);
}

await ensureReplacement(
  'src/components/QuickPanel.svelte',
  `    onSave: (payload: { name: string; note: string; ignoreApps: string[] }) => void;`,
  `    onSave: (payload: { name: string; note: string; ignoreApps: string[]; captureServices: boolean }) => void;`
);

await ensureReplacement(
  'src/components/FullApp.svelte',
  `    onSave: (payload: { name: string; note: string; ignoreApps: string[] }) => void;`,
  `    onSave: (payload: { name: string; note: string; ignoreApps: string[]; captureServices: boolean }) => void;`
);

await ensureReplacement(
  'src-tauri/src/lib.rs',
  `#[derive(Debug, Deserialize)]\n#[serde(\n    tag = "kind",\n    rename_all = "kebab-case",\n    rename_all_fields = "camelCase"\n)]\nenum OperationRequest {`,
  `fn default_capture_services() -> bool {\n    true\n}\n\n#[derive(Debug, Deserialize)]\n#[serde(\n    tag = "kind",\n    rename_all = "kebab-case",\n    rename_all_fields = "camelCase"\n)]\nenum OperationRequest {`
);

await ensureReplacement(
  'src-tauri/src/lib.rs',
  `    Save {\n        name: String,\n        note: Option<String>,\n        #[serde(default)]\n        ignore_apps: Vec<String>,\n    },`,
  `    Save {\n        name: String,\n        note: Option<String>,\n        #[serde(default)]\n        ignore_apps: Vec<String>,\n        #[serde(default = "default_capture_services")]\n        capture_services: bool,\n    },`
);

await ensureReplacement(
  'src-tauri/src/lib.rs',
  `        OperationRequest::Save {\n            name,\n            note,\n            ignore_apps,\n        } => {\n            require_nonempty("capsule name", name)?;\n            args.extend(["save".to_owned(), name.clone(), "--cli-force".to_owned()]);`,
  `        OperationRequest::Save {\n            name,\n            note,\n            ignore_apps,\n            capture_services,\n        } => {\n            require_nonempty("capsule name", name)?;\n            args.extend(["save".to_owned(), name.clone()]);\n            if *capture_services {\n                args.push("--cli-force".to_owned());\n            }`
);

await ensureReplacement(
  'src-tauri/src/lib.rs',
  `        let request = OperationRequest::Save {\n            name: "demo".to_owned(),\n            note: None,\n            ignore_apps: vec![],\n        };\n        let (program, args) = operation_command(&request).unwrap();\n        assert_eq!(program, "capsule-agent-worker");\n        assert_eq!(args, ["save", "demo", "--cli-force"]);\n    }`,
  `        let request = OperationRequest::Save {\n            name: "demo".to_owned(),\n            note: None,\n            ignore_apps: vec![],\n            capture_services: true,\n        };\n        let (program, args) = operation_command(&request).unwrap();\n        assert_eq!(program, "capsule-agent-worker");\n        assert_eq!(args, ["save", "demo", "--cli-force"]);\n    }\n\n    #[test]\n    fn save_can_leave_running_services_untouched() {\n        let request = OperationRequest::Save {\n            name: "demo".to_owned(),\n            note: None,\n            ignore_apps: vec![],\n            capture_services: false,\n        };\n        let (program, args) = operation_command(&request).unwrap();\n        assert_eq!(program, "capsule-agent-worker");\n        assert_eq!(args, ["save", "demo"]);\n    }`
);

const testPath = resolve(root, 'tests/save-integration.test.mjs');
const testSource = (await readFile(testPath, 'utf8')).replace(/\r\n/g, '\n');
if (!testSource.includes(`test('save exposes a friendly choice to leave running services untouched'`)) {
  await writeFile(testPath, `${testSource}\n\ntest('save exposes a friendly choice to leave running services untouched', async () => {\n  const modal = await read('src/components/SaveModal.svelte');\n  const app = await read('src/App.svelte');\n  const quick = await read('src/components/QuickPanel.svelte');\n  const full = await read('src/components/FullApp.svelte');\n  const types = await read('src/lib/types.ts');\n  const backend = await read('src-tauri/src/lib.rs');\n\n  assert.match(modal, /let captureServices = \\$state\\(true\\)/);\n  assert.match(modal, /Pause & remember running terminal services/);\n  assert.match(modal, /Turn this off to leave them running/);\n  assert.match(modal, /onsave\\(\\{ name: clean, note: note\\.trim\\(\\), ignoreApps: effectiveIgnored, captureServices \\}\\)/);\n  assert.match(app, /captureServices: payload\\.captureServices/);\n  assert.match(quick, /captureServices: boolean/);\n  assert.match(full, /captureServices: boolean/);\n  assert.match(types, /captureServices: boolean/);\n  assert.match(backend, /default_capture_services/);\n  assert.match(backend, /if \\*capture_services \\{[\\s\\S]*args\\.push\\("--cli-force"\\.to_owned\\(\\)\\)/);\n  assert.match(backend, /fn save_can_leave_running_services_untouched/);\n});\n\ntest('full Save has nested hidden-scrollbar scrolling without trapping the outer dialog', async () => {\n  const css = await read('src/full-save-scroll.css');\n  assert.match(css, /data-window-mode='full'\\] \\.app-check-list \\{[\\s\\S]*overflow-y: auto;[\\s\\S]*overscroll-behavior-y: auto;[\\s\\S]*scrollbar-width: none/);\n  assert.match(css, /data-window-mode='full'\\] \\.modal-backdrop \\{[\\s\\S]*place-items: start center;[\\s\\S]*overflow-y: auto;[\\s\\S]*scrollbar-width: none/);\n  assert.match(css, /data-window-mode='full'\\] \\.modal-scroll \\{[\\s\\S]*flex: 1 1 auto;[\\s\\S]*overflow-y: auto;[\\s\\S]*scrollbar-width: none/);\n});\n`, 'utf8');
  console.log('patched tests/save-integration.test.mjs');
} else {
  console.log('already patched tests/save-integration.test.mjs');
}
