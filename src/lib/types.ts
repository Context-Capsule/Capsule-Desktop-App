export type CapsuleSummary = {
  name: string;
  created_at_unix_ms: number;
  updated_at_unix_ms: number;
  schema_version: number;
  current_revision: number;
  revision_count: number;
  applications: number;
  browser_tabs: number;
  editor_tabs: number;
  terminals: number;
  services: number;
  docker_containers: number;
  note?: string | null;
};

export type ServiceSummary = {
  service_index: number;
  source: string;
  host: string;
  shell: string;
  terminal_name?: string | null;
  profile?: string | null;
  working_directory?: string | null;
  command: string;
  pre_start_command?: string | null;
  restart_policy: 'ask' | 'always' | string;
};

export type RevisionSummary = {
  name: string;
  revision: number;
  created_at_unix_ms: number;
  schema_version: number;
  current: boolean;
  note?: string | null;
};

export type DesktopContract = {
  api_version: number;
  cli_version: string;
  features: string[];
};

export type OverviewData = { capsules: CapsuleSummary[] };
export type HistoryData = { capsule: string; revisions: RevisionSummary[] };
export type ServicesData = { reference: string; services: ServiceSummary[] };

export type OperationDecision = {
  serviceIndex: number;
  decision: 'once' | 'always' | 'skip';
};

export type OperationRequest =
  | { kind: 'save'; name: string; note?: string; ignoreApps: string[]; captureServices: boolean }
  | { kind: 'update'; name: string; ignoreApps: string[] }
  | { kind: 'restore'; reference: string; replace?: boolean; only?: string[]; decisions?: OperationDecision[] }
  | { kind: 'delete'; name: string }
  | { kind: 'note'; reference: string; message: string }
  | { kind: 'service-policy'; reference: string; serviceIndex: number; policy: 'ask' | 'always' }
  | { kind: 'service-prestart'; reference: string; serviceIndex: number; command?: string | null }
  | { kind: 'install-browser-host'; browser: 'firefox' | 'chrome' };

export type OperationResult = {
  operationId: string;
  code: number;
  success: boolean;
  cancelled: boolean;
  stdout: string;
  stderr: string;
};

export type OperationEvent = {
  operationId: string;
  stream: 'stdout' | 'stderr' | 'status';
  text: string;
  phase: string;
};

export type Settings = {
  startWithWindows: boolean;
  notifications: boolean;
  autoCloseQuickPanel: boolean;
  reduceMotion: boolean;
  glassIntensity: number;
  restoreMode: 'append' | 'replace';
};

export const defaultSettings: Settings = {
  startWithWindows: true,
  notifications: true,
  autoCloseQuickPanel: true,
  reduceMotion: false,
  glassIntensity: 0.13,
  restoreMode: 'append'
};