export interface CalendarCell {
  date: Date;
  isCurrentMonth: boolean;
  isToday: boolean;
}

export function getMonthDays(year: number, month: number): CalendarCell[] {
  const today = new Date();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const firstDow = (firstDay.getDay() + 6) % 7; // Mon=0

  const prevMonth = month === 0 ? 11 : month - 1;
  const prevYear = month === 0 ? year - 1 : year;
  const daysInPrev = new Date(year, month, 0).getDate();

  const cells: CalendarCell[] = [];

  // Prev month fill
  for (let i = firstDow - 1; i >= 0; i--) {
    const d = daysInPrev - i;
    cells.push({
      date: new Date(prevYear, prevMonth, d),
      isCurrentMonth: false,
      isToday: false,
    });
  }
  // Current month
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    cells.push({
      date,
      isCurrentMonth: true,
      isToday: isSameDay(date, today),
    });
  }
  // Next month fill
  const rem = cells.length % 7;
  if (rem !== 0) {
    const nextMonth = month === 11 ? 0 : month + 1;
    const nextYear = month === 11 ? year + 1 : year;
    for (let d = 1; d <= 7 - rem; d++) {
      cells.push({
        date: new Date(nextYear, nextMonth, d),
        isCurrentMonth: false,
        isToday: false,
      });
    }
  }
  return cells;
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth() === b.getMonth() &&
         a.getDate() === b.getDate();
}

export function formatTime24(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

export function getCurrentTimePosition(hour: number, minute: number, rowHeight: number): number {
  return hour * rowHeight + minute;
}
