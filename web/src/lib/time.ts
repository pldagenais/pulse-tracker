// Local-day helpers.
//
// In local mode the browser and the server share a machine, so the browser
// zone is the truth. In cloud mode every mirrored day key (overview:<day>,
// calendar:<id>:<month>) was minted in the AGENT's zone — a phone one zone
// ahead would otherwise ask for tomorrow-on-the-PC, a key that never exists,
// and render skeletons forever. TzGate sets the agent zone before the cloud
// app renders its first query, so keys are right from the start.
//
// Only dayKeyOf/todayKey are zone-sensitive: everything else here is pure
// calendar math on day STRINGS, identical in every zone.

const pad = (n: number) => String(n).padStart(2, '0');

let dayKeyZone: string | null = null;
let zoneFmt: Intl.DateTimeFormat | null = null;

/** Cloud mode only: format day keys in the agent's IANA zone from here on. */
export function setDayKeyZone(tz: string | null): void {
  if (!tz || tz === dayKeyZone) return;
  try {
    // en-CA yields YYYY-MM-DD directly
    zoneFmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    dayKeyZone = tz;
  } catch {
    // unknown zone string: keep the browser-zone fallback
    zoneFmt = null;
    dayKeyZone = null;
  }
}

export function dayKeyOf(ts: number | Date): string {
  const d = ts instanceof Date ? ts : new Date(ts);
  if (zoneFmt) return zoneFmt.format(d);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayKey(): string {
  return dayKeyOf(new Date());
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return dayKeyOf(new Date(y, m - 1, d + n));
}

export function dayStartMs(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

export function dayEndMs(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d + 1).getTime();
}

/** Monday-start week containing `day`. */
export function weekOf(day: string): string[] {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const dow = (date.getDay() + 6) % 7; // 0 = Monday
  const monday = new Date(y, m - 1, d - dow);
  return Array.from({ length: 7 }, (_, i) => dayKeyOf(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)));
}

/** All day-keys of the month containing `day`, plus leading/trailing to fill Monday-start weeks. */
export function monthGrid(day: string): { days: string[]; monthStart: string } {
  const [y, m] = day.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const lead = (first.getDay() + 6) % 7;
  const start = new Date(y, m - 1, 1 - lead);
  const days: string[] = [];
  for (let i = 0; i < 42; i++) {
    days.push(dayKeyOf(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)));
  }
  // trim trailing full weeks outside the month
  while (days.length > 7 && days[days.length - 7].slice(0, 7) !== day.slice(0, 7)) {
    days.splice(-7, 7);
  }
  return { days, monthStart: dayKeyOf(first) };
}

export function isToday(day: string): boolean {
  return day === todayKey();
}

export function monthKey(day: string): string {
  return day.slice(0, 7);
}

export function addMonths(day: string, n: number): string {
  const [y, m] = day.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return dayKeyOf(d);
}
