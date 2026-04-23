interface ParsedEvent {
  title: string;
  hour: number;
  date: Date;
}

/**
 * Parses natural language date/time from event input.
 * Handles: 3pm, 14:00, tomorrow, today, Monday–Sunday (next occurrence)
 * Returns: { title, hour, date } with title cleaned and defaults applied.
 */
export function parseNaturalDate(input: string, defaultDate: Date): ParsedEvent {
  let t = input.toLowerCase().trim();
  let hour = 9;
  let date = new Date(defaultDate);

  // Relative days — process first so combined "3pm tomorrow" works
  if (/\btomorrow\b/.test(t)) {
    date = new Date(date);
    date.setDate(date.getDate() + 1);
    t = t.replace(/\btomorrow\b/, '').trim();
  }
  if (/\btoday\b/.test(t)) {
    t = t.replace(/\btoday\b/, '').trim();
  }

  // Time: "3pm" / "3 pm" / "at 3pm" / "14:00"
  const timeMatch = t.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/) ||
                    t.match(/(\d{1,2})\s*(am|pm)/);
  if (timeMatch) {
    const rawHour = parseInt(timeMatch[1]);
    const isPM = timeMatch[0].includes('pm');
    hour = isPM && rawHour < 12 ? rawHour + 12
         : !isPM && rawHour === 12 ? 0
         : rawHour;
    t = t.replace(timeMatch[0], '').replace(/^at\s+/, '').trim();
  }

  // Weekdays — check full names first, then abbreviations
  // Order matters: "thursday" must be checked before "tue" (which is in "thursday")
  const fullNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const abbrevs = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const isoMap: Record<string, number> = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
    thursday: 4, friday: 5, saturday: 6,
  };

  for (const name of fullNames) {
    if (t.includes(name)) {
      const targetDow = isoMap[name];
      const currDow = date.getDay();
      let daysUntil = (targetDow - currDow + 7) % 7;
      if (daysUntil === 0) daysUntil = 7; // next week
      date = new Date(date);
      date.setDate(date.getDate() + daysUntil);
      t = t.replace(new RegExp(name), '').trim();
      break;
    }
  }

  if (t.length > 0 && !t.match(/^\d/)) {
    for (const name of abbrevs) {
      if (t.includes(name)) {
        const targetDow = isoMap[name.slice(0, 3) as keyof typeof isoMap];
        const currDow = date.getDay();
        let daysUntil = (targetDow - currDow + 7) % 7;
        if (daysUntil === 0) daysUntil = 7;
        date = new Date(date);
        date.setDate(date.getDate() + daysUntil);
        t = t.replace(new RegExp(name), '').trim();
        break;
      }
    }
  }

  // Strip leading prepositions
  const title = t.replace(/^(at|on|in)\s+/, '').replace(/\s+/g, ' ').trim();
  return { title, hour, date };
}
