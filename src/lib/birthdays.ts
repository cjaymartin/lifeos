// ── Birthday urgency logic ────────────────────────────────────────────────────
//
// Pure date/urgency math for the Birthday dashboard widget. The populator stores
// the *next occurrence* of each birthday (name + YYYY-MM-DD); urgency is computed
// live at render time against the current date, so the card/banner stay correct
// even if today.json is a day stale.
//
// Thresholds (per owner decision):
//   • imminent / yellow card → birthday is today or tomorrow (≤ 1 day)
//   • banner                 → birthday is *today* only (see birthdaysToday)

export interface Birthday {
  /** Display name, e.g. "Anna" (the "'s Birthday" suffix is stripped by the populator). */
  name: string;
  /** Next occurrence, YYYY-MM-DD. */
  date: string;
}

export interface BirthdayView extends Birthday {
  daysUntil: number;
  /** "Today" | "Tomorrow" | "in N days" */
  label: string;
  /** Within the yellow threshold (today or tomorrow). */
  imminent: boolean;
  isToday: boolean;
}

/** Card goes yellow when a birthday is this many days out or fewer. */
export const IMMINENT_WITHIN_DAYS = 1;

function toUTCDay(d: string): number {
  const [y, m, day] = d.split('-').map(Number);
  return Date.UTC(y, m - 1, day);
}

/** Whole calendar days from `today` to `date` (both YYYY-MM-DD). DST-immune. */
export function daysUntil(date: string, today: string): number {
  return Math.round((toUTCDay(date) - toUTCDay(today)) / 86_400_000);
}

function labelFor(daysUntil: number): string {
  if (daysUntil === 0) return 'Today';
  if (daysUntil === 1) return 'Tomorrow';
  return `in ${daysUntil} days`;
}

/**
 * Annotate each upcoming birthday with urgency metadata, sorted soonest-first.
 * Past birthdays (daysUntil < 0) are dropped.
 */
export function describeBirthdays(birthdays: Birthday[], today: string): BirthdayView[] {
  return birthdays
    .map((b) => {
      const d = daysUntil(b.date, today);
      return {
        ...b,
        daysUntil: d,
        label: labelFor(d),
        imminent: d <= IMMINENT_WITHIN_DAYS,
        isToday: d === 0,
      };
    })
    .filter((v) => v.daysUntil >= 0)
    .sort((a, b) => a.daysUntil - b.daysUntil);
}

/** Any birthday within the yellow threshold → tint the card. */
export function anyImminent(views: BirthdayView[]): boolean {
  return views.some((v) => v.imminent);
}

/** Birthdays falling today → drive the urgent banner. */
export function birthdaysToday(views: BirthdayView[]): BirthdayView[] {
  return views.filter((v) => v.isToday);
}
