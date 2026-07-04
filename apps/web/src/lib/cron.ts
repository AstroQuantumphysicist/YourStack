/**
 * Lightweight, dependency-free helpers for describing standard 5-field cron
 * expressions (`minute hour day-of-month month day-of-week`) in plain English.
 * This is a best-effort humaniser for the common cases people actually write —
 * anything it can't confidently describe falls back to the raw expression.
 */

export interface CronPreset {
  label: string;
  expression: string;
}

/** Common schedules offered as one-tap presets in the create dialog. */
export const CRON_PRESETS: CronPreset[] = [
  { label: 'Every minute', expression: '* * * * *' },
  { label: 'Every 5 minutes', expression: '*/5 * * * *' },
  { label: 'Every 15 minutes', expression: '*/15 * * * *' },
  { label: 'Every hour', expression: '0 * * * *' },
  { label: 'Every day at midnight', expression: '0 0 * * *' },
  { label: 'Every day at 9am', expression: '0 9 * * *' },
  { label: 'Every Monday at 9am', expression: '0 9 * * 1' },
  { label: 'First of the month', expression: '0 0 1 * *' },
];

const DAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/** Format an hour/minute pair as a 12-hour clock time, e.g. "9:05am". */
function clock(hour: number, minute: number): string {
  const period = hour < 12 ? 'am' : 'pm';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const mm = String(minute).padStart(2, '0');
  return `${h12}:${mm}${period}`;
}

/**
 * Returns a human sentence for a cron expression, or `null` when the input is
 * not a well-formed 5-field expression the humaniser understands.
 */
export function describeCron(expr: string): string | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour, dom, month, dow] = parts as [string, string, string, string, string];

  const isNum = (s: string) => /^\d+$/.test(s);
  const stepEvery = (s: string): number | null => {
    const m = /^\*\/(\d+)$/.exec(s);
    return m ? Number(m[1]) : null;
  };

  const domAny = dom === '*';
  const monthAny = month === '*';
  const dowAny = dow === '*';

  // Frequency of the time-of-day component.
  const minStep = stepEvery(min);
  const hourStep = stepEvery(hour);

  // "* * * * *" — every minute
  if (min === '*' && hour === '*' && domAny && monthAny && dowAny) return 'Every minute';

  // "*/n * * * *" — every n minutes
  if (minStep && hour === '*' && domAny && monthAny && dowAny) {
    return `Every ${minStep} minutes`;
  }

  // "0 * * * *" — hourly (optionally at a specific minute)
  if (isNum(min) && hour === '*' && domAny && monthAny && dowAny) {
    return Number(min) === 0 ? 'Every hour' : `Every hour at :${min.padStart(2, '0')}`;
  }

  // "0 */n * * *" — every n hours
  if (isNum(min) && hourStep && domAny && monthAny && dowAny) {
    return `Every ${hourStep} hours`;
  }

  // Specific time of day from here on.
  if (!isNum(min) || !isNum(hour)) return null;
  const at = clock(Number(hour), Number(min));

  // Day-of-week schedule, e.g. "0 9 * * 1"
  if (isNum(dow) && domAny && monthAny) {
    const day = DAYS[Number(dow) % 7];
    return day ? `Every ${day} at ${at}` : null;
  }

  // Day-of-month schedule, e.g. "0 0 1 * *"
  if (isNum(dom) && dowAny) {
    if (monthAny) return `On the ${ordinal(Number(dom))} of every month at ${at}`;
    if (isNum(month)) {
      const name = MONTHS[Number(month) - 1];
      return name ? `On ${name} ${ordinal(Number(dom))} at ${at}` : null;
    }
  }

  // Plain daily schedule, e.g. "0 0 * * *"
  if (domAny && monthAny && dowAny) return `Every day at ${at}`;

  return null;
}

/** A basic sanity check that an expression has five whitespace-separated fields. */
export function isValidCronShape(expr: string): boolean {
  return expr.trim().split(/\s+/).length === 5;
}
