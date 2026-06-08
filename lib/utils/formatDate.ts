// Short date range for public display: day.month, no leading zeros, no year —
// e.g. "5.9.–12.9." (dates are stored UTC; these are calendar-day labels).
export function formatDateRangeShort(startDate: string, endDate: string): string {
  const fmt = (iso: string): string => {
    const [, month = '', day = ''] = iso.split('-')
    return `${Number(day)}.${Number(month)}.`
  }
  return `${fmt(startDate)}–${fmt(endDate)}`
}
