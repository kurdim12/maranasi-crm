/** Local wall-clock info for a timezone via Intl (available in workerd). */
export function localClock(tz: string, date = new Date()): { weekday: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    weekday: get('weekday'),
    hour: parseInt(get('hour'), 10) % 24, // Intl can emit "24" for midnight
    minute: parseInt(get('minute'), 10),
  };
}

/** Deliverability guardrail: send only Mon-Fri, 09:00-16:30 in the lead's timezone. */
export function isWithinSendWindow(tz: string, date = new Date()): boolean {
  let clock;
  try {
    clock = localClock(tz || 'Asia/Bangkok', date);
  } catch {
    clock = localClock('Asia/Bangkok', date); // bad tz string: fall back, never crash the engine
  }
  const { weekday, hour, minute } = clock;
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  const mins = hour * 60 + minute;
  return mins >= 9 * 60 && mins <= 16 * 60 + 30;
}
