// Short date range for public display: day.month, no leading zeros, no year —
// e.g. "5.9.–12.9." (dates are stored UTC; these are calendar-day labels).
export function formatDateRangeShort(startDate: string, endDate: string): string {
  const fmt = (iso: string): string => {
    const [, month = '', day = ''] = iso.split('-')
    return `${Number(day)}.${Number(month)}.`
  }
  return `${fmt(startDate)}–${fmt(endDate)}`
}

// Europe/Prague wall clock for the meal-ordering cut-off — "16. 9. 2026 23:59".
//
// The DTO carries the deadline as a UTC ISO string (invariant 11), and Kolíňáci
// stores 2026-09-16T21:59Z, which IS 23:59 in Prague. Printed in UTC that reads
// two hours early — on the one number whose whole purpose is a cut-off.
//
// Built from Intl parts by hand rather than from a locale's own datetime format,
// for the same reason formatDateRangeShort is: the public page shows one numeric
// style in both languages, and a locale-formatted string would silently change
// shape (and separator) between cs and en.
//
// ONE formatter, deliberately: this string is rendered twice — under the contact
// block on the event page and inside the link-preview description — and two
// renderings of one deadline that can disagree is a bug waiting for the day
// somebody edits one of them.
export function formatDeadlineDateTime(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Prague',
    hour12: false,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(iso))
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? ''
  // Intl can emit "24" for midnight in hour12:false.
  const hour = get('hour') === '24' ? '00' : get('hour')
  return `${Number(get('day'))}. ${Number(get('month'))}. ${get('year')} ${hour}:${get('minute')}`
}
