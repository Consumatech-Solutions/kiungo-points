// Period maths in a person's own time zone. Copied from the AMU engine (packages/core/src/periods.ts, ADR-002),
// with Kiungo's period names and a quarter added.
export type Period = 'once' | 'daily' | 'weekly' | 'monthly' | 'quarterly';
export type Granularity = 'daily' | 'weekly' | 'monthly';

const DAY_MS = 86_400_000;

interface LocalDate { y: number; m: number; d: number } // m is 1-12

/** Civil (calendar) Y/M/D of an instant in the given IANA timezone. */
function localDate(occurredAtMs: number, timezone: string): LocalDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(occurredAtMs));
  let y = 0, m = 0, d = 0;
  for (const p of parts) {
    if (p.type === 'year') y = Number(p.value);
    else if (p.type === 'month') m = Number(p.value);
    else if (p.type === 'day') d = Number(p.value);
  }
  return { y, m, d };
}

/** ISO-8601 (Monday-start) week for a civil date, plus the Monday's UTC ms. */
function isoWeek(ld: LocalDate): { isoYear: number; week: number; mondayMs: number } {
  const utc = Date.UTC(ld.y, ld.m - 1, ld.d);
  const dayNum = (new Date(utc).getUTCDay() + 6) % 7; // Mon=0..Sun=6
  const mondayMs = utc - dayNum * DAY_MS;
  const thursday = new Date(mondayMs + 3 * DAY_MS);
  const isoYear = thursday.getUTCFullYear();
  const firstThursdayMs = Date.UTC(isoYear, 0, 4);
  const firstMondayMs = firstThursdayMs - ((new Date(firstThursdayMs).getUTCDay() + 6) % 7) * DAY_MS;
  const week = 1 + Math.round((mondayMs - firstMondayMs) / (7 * DAY_MS));
  return { isoYear, week, mondayMs };
}

/** The label of the period an instant falls in, in the person's time zone: `once`, `2026-10-22`, `2026-W43`, `2026-10`, `2026-Q4`. */
export function periodKey(occurredAt: string, period: Period, timezone: string): string {
  if (period === 'once') return 'once';
  const ld = localDate(Date.parse(occurredAt), timezone);
  const mm = String(ld.m).padStart(2, '0');
  if (period === 'monthly') return `${ld.y}-${mm}`;
  if (period === 'quarterly') return `${ld.y}-Q${Math.ceil(ld.m / 3)}`;
  if (period === 'daily') return `${ld.y}-${mm}-${String(ld.d).padStart(2, '0')}`;
  const { isoYear, week } = isoWeek(ld);
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

/** Monotonic integer for a period; consecutive periods differ by exactly 1. Used by streaks. */
export function periodOrdinal(occurredAt: string, granularity: Granularity, timezone: string): number {
  const ld = localDate(Date.parse(occurredAt), timezone);
  if (granularity === 'monthly') return ld.y * 12 + (ld.m - 1);
  if (granularity === 'daily') return Math.floor(Date.UTC(ld.y, ld.m - 1, ld.d) / DAY_MS);
  return Math.floor(isoWeek(ld).mondayMs / (7 * DAY_MS));
}

/** True for a time zone name the runtime knows, such as `Africa/Kinshasa`. */
export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
