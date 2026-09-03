const SIDEBAR_BREAKPOINT = 820;

export function installResponsiveSidebar() {
  const root = document.querySelector<HTMLElement>('.full-root');
  const sidebar = root?.querySelector<HTMLElement>('.sidebar');
  const brand = sidebar?.querySelector<HTMLElement>('.full-brand');
  if (!root || !sidebar || !brand) return () => undefined;

  let narrow = window.innerWidth <= SIDEBAR_BREAKPOINT;
  let expanded = !narrow;

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'sidebar-toggle';
  toggle.dataset.sidebarToggle = 'true';

  const apply = () => {
    root.classList.toggle('sidebar-collapsed', !expanded);
    toggle.dataset.state = expanded ? 'expanded' : 'collapsed';
    toggle.textContent = expanded ? '‹' : '›';
    const label = expanded ? 'Collapse sidebar' : 'Expand sidebar';
    toggle.setAttribute('aria-label', label);
    toggle.title = label;
  };

  const onToggle = () => {
    expanded = !expanded;
    apply();
  };

  const onResize = () => {
    const nextNarrow = window.innerWidth <= SIDEBAR_BREAKPOINT;
    if (nextNarrow === narrow) return;

    narrow = nextNarrow;
    // Crossing the layout breakpoint chooses a sensible default. Manual state
    // remains untouched while the user keeps resizing within the same range.
    expanded = !nextNarrow;
    apply();
  };

  toggle.addEventListener('click', onToggle);
  brand.append(toggle);
  window.addEventListener('resize', onResize);
  apply();

  return () => {
    window.removeEventListener('resize', onResize);
    toggle.removeEventListener('click', onToggle);
    toggle.remove();
    root.classList.remove('sidebar-collapsed');
  };
}

export { SIDEBAR_BREAKPOINT };
