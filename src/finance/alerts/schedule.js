// When a scheduled alert is due, in the rule's own time zone.

/** Local date / time / weekday for an instant in a time zone. */
export function localParts(now, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, weekday, day: Number(parts.day) };
}

/**
 * The slot a scheduled rule should send for at `now` (its local date), or
 * null when it isn't due: the right day, at or after its time, and not already
 * sent for that slot (`last_period`). Real-time rules have no slot.
 */
export function dueSlot(rule, now) {
  if (rule.cadence === 'realtime') return null;
  const p = localParts(now, rule.timezone || 'America/New_York');
  if (p.time < rule.send_time) return null;
  if (rule.cadence === 'weekly' && p.weekday !== Number(rule.weekday ?? 1)) return null;
  if (rule.cadence === 'monthly' && p.day !== Number(rule.month_day ?? 1)) return null;
  if (rule.last_period === p.date) return null;
  return p.date;
}
