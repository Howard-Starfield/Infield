/** Shared slot snapping for calendar create / drag (minutes). */
export const CALENDAR_SNAP_MIN = 15

export function snapZonedToSlotMinutes(zdt: Temporal.ZonedDateTime): Temporal.ZonedDateTime {
  const p = zdt.toPlainDateTime()
  const total = p.hour * 60 + p.minute + p.second / 60 + p.millisecond / 60000
  const snapped = Math.round(total / CALENDAR_SNAP_MIN) * CALENDAR_SNAP_MIN
  const h = Math.floor(snapped / 60)
  const m = Math.floor(snapped % 60)
  const plain = Temporal.PlainDateTime.from({
    year: p.year,
    month: p.month,
    day: p.day,
    hour: h,
    minute: m,
    second: 0,
    millisecond: 0,
  })
  return plain.toZonedDateTime(zdt.timeZoneId)
}
