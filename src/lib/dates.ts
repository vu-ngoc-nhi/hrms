// Business dates are YYYY-MM-DD strings without time. Stored in DATE columns via UTC midnight to avoid timezone drift.
const VN_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Ho_Chi_Minh",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function todayInVietnam(now: Date = new Date()): string {
  return VN_DATE.format(now);
}

export function toDbDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

export function fromDbDate(d: Date): string;
export function fromDbDate(d: Date | null): string | null;
export function fromDbDate(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

export function addDays(isoDate: string, days: number): string {
  const d = toDbDate(isoDate);
  d.setUTCDate(d.getUTCDate() + days);
  return fromDbDate(d);
}
