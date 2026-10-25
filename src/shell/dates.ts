// Dates as the pages show them. Dates are YYYY-MM-DD strings, parsed by hand so no time zone can
// shift them; "today" is always passed in.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 86_400_000;

/** Days since 1970-01-01 for a YYYY-MM-DD date. */
function dayNumber(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

/** The local calendar date, YYYY-MM-DD. */
export function todayISO(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** This moment as a UTC ISO string, the way every saved time is kept. */
export const nowISO = () => new Date().toISOString();

export const daysBetween = (from: string, to: string) => dayNumber(to) - dayNumber(from);

/** "2026-04-29" -> "Apr 29". */
export function monthDayLabel(date: string): string {
  const [, m, d] = date.split("-");
  return `${MONTHS[Number(m) - 1]} ${Number(d)}`;
}

/** "2026-04-29" -> "Apr 29, 2026". */
export const dateLabel = (date: string) => `${monthDayLabel(date)}, ${date.slice(0, 4)}`;
