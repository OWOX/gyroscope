const ALIASES = new Map([
  ['Etc/UTC', 'UTC'],
  ['GMT', 'UTC'],
  ['Etc/GMT', 'UTC'],
  ['Europe/Kiev', 'Europe/Kyiv'],
]);

export function canonicalTimeZone(zone: string): string {
  return ALIASES.get(zone) ?? zone;
}

export function browserTimeZone(): string {
  return canonicalTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
}

function zoneLabel(zone: string, aliases: string[], now: Date): string {
  if (zone === 'UTC') return 'UTC (+00:00)';
  for (const timeZone of [zone, ...aliases]) {
    try {
      const formatter = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' });
      const offset = formatter.formatToParts(now).find((part) => part.type === 'timeZoneName')?.value;
      if (offset?.startsWith('GMT')) return `${zone} (${offset.slice(3) || '+00:00'})`;
    } catch {
      // Older runtimes may accept only the legacy identifier.
    }
  }
  return zone;
}

export function timeZoneOptions(selected: string) {
  const runtimeZones = Intl.supportedValuesOf?.('timeZone') ?? [browserTimeZone()];
  const zones = new Set(['UTC', ...runtimeZones.map(canonicalTimeZone), canonicalTimeZone(selected)]);
  const now = new Date();
  return [...zones].map((value) => {
    const aliases = [...ALIASES.keys()].filter((alias) => ALIASES.get(alias) === value);
    return { value, label: zoneLabel(value, aliases, now), keywords: aliases };
  });
}
