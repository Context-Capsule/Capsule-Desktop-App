export function relativeTime(unixMs: number): string {
  const delta = Date.now() - unixMs;
  const future = delta < 0;
  const abs = Math.abs(delta);
  const units: Array<[number, Intl.RelativeTimeFormatUnit]> = [
    [86_400_000, 'day'],
    [3_600_000, 'hour'],
    [60_000, 'minute'],
    [1_000, 'second']
  ];
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [size, unit] of units) {
    if (abs >= size || unit === 'second') {
      const value = Math.max(1, Math.round(abs / size)) * (future ? 1 : -1);
      return formatter.format(value, unit);
    }
  }
  return 'now';
}

export function formatDate(unixMs: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(unixMs);
}

export function metricLine(parts: Array<[number, string]>): string {
  return parts.filter(([value]) => value > 0).map(([value, label]) => `${value} ${label}`).join(' · ') || 'Workspace captured';
}

export function shortenPath(value?: string | null, max = 54): string {
  if (!value || value.length <= max) return value ?? '';
  const normalized = value.replaceAll('\\', '/');
  const pieces = normalized.split('/');
  if (pieces.length < 3) return `…${value.slice(-(max - 1))}`;
  return `${pieces[0]}/…/${pieces.slice(-2).join('/')}`;
}
