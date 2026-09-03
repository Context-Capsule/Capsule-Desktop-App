const SIDEBAR_BREAKPOINT = 820;
const SIDEBAR_PREFERENCE_KEY = 'context-capsule:sidebar-expanded:v2';

function readWidePreference() {
  try {
    const value = localStorage.getItem(SIDEBAR_PREFERENCE_KEY);
    return value === null ? true : value === 'true';
  } catch {
    return true;
  }
}

export function installResponsiveSidebar() {
  const root = document.querySelector<HTMLElement>('.full-root');
  const sidebar = root?.querySelector<HTMLElement>('.sidebar');
  if (!root || !sidebar) return () => undefined;

  const media = window.matchMedia(`(max-width: ${SIDEBAR_BREAKPOINT}px)`);
  let expanded = media.matches ? false : readWidePreference();
  let manualNarrowChoice: boolean | null = null;

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'sidebar-toggle';
  toggle.dataset.sidebarToggle = 'true';
  toggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 6.5-5 5.5 5 5.5"/></svg>';
  sidebar.append(toggle);

  for (const button of sidebar.querySelectorAll<HTMLButtonElement>('nav button')) {
    const label = button.textContent?.trim();
    if (label) button.dataset.sidebarLabel = label;
  }

  const apply = () => {
    root.classList.toggle('sidebar-collapsed', !expanded);
    sidebar.dataset.state = expanded ? 'expanded' : 'collapsed';
    toggle.dataset.state = expanded ? 'expanded' : 'collapsed';
    toggle.setAttribute('aria-expanded', String(expanded));
    const label = expanded ? 'Collapse sidebar' : 'Expand sidebar';
    toggle.setAttribute('aria-label', label);
    toggle.title = label;
  };

  const onToggle = () => {
    expanded = !expanded;
    if (media.matches) {
      manualNarrowChoice = expanded;
    } else {
      try { localStorage.setItem(SIDEBAR_PREFERENCE_KEY, String(expanded)); } catch {}
    }
    apply();
  };

  const onBreakpoint = (event: MediaQueryListEvent) => {
    expanded = event.matches ? (manualNarrowChoice ?? false) : readWidePreference();
    apply();
  };

  toggle.addEventListener('click', onToggle);
  media.addEventListener('change', onBreakpoint);
  apply();

  return () => {
    media.removeEventListener('change', onBreakpoint);
    toggle.removeEventListener('click', onToggle);
    toggle.remove();
    root.classList.remove('sidebar-collapsed');
    delete sidebar.dataset.state;
  };
}

export { SIDEBAR_BREAKPOINT };
