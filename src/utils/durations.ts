/** Matches an ISO 8601 duration limited to the day-and-below components CCloud actually emits. */
const ISO_DURATION_PATTERN =
  /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

const MILLIS_PER_SECOND = 1000;
const MILLIS_PER_MINUTE = 60 * MILLIS_PER_SECOND;
const MILLIS_PER_HOUR = 60 * MILLIS_PER_MINUTE;
const MILLIS_PER_DAY = 24 * MILLIS_PER_HOUR;

/**
 * Render a span of milliseconds the way someone timing a query would read it: coarse units when the
 * wait is long, sub-second precision when it's short.
 *
 * @param millis Duration in milliseconds. Negative values are treated as zero.
 */
export function formatDurationMillis(millis: number): string {
  if (!Number.isFinite(millis) || millis <= 0) {
    return "0s";
  }

  if (millis >= MILLIS_PER_HOUR) {
    const hours = Math.floor(millis / MILLIS_PER_HOUR);
    const minutes = Math.floor((millis % MILLIS_PER_HOUR) / MILLIS_PER_MINUTE);
    const seconds = Math.floor((millis % MILLIS_PER_MINUTE) / MILLIS_PER_SECOND);
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  if (millis >= MILLIS_PER_MINUTE) {
    const minutes = Math.floor(millis / MILLIS_PER_MINUTE);
    const seconds = Math.floor((millis % MILLIS_PER_MINUTE) / MILLIS_PER_SECOND);
    return `${minutes}m ${seconds}s`;
  }

  if (millis >= MILLIS_PER_SECOND) {
    // one decimal place is enough to tell 1.2s from 1.9s without looking noisy
    return `${(millis / MILLIS_PER_SECOND).toFixed(1)}s`;
  }

  return `${Math.round(millis)}ms`;
}

/**
 * Convert an ISO 8601 duration string (say, `PT1M30S`) to milliseconds.
 *
 * @returns The duration in milliseconds, or undefined if the string isn't a duration we recognize,
 *   leaving the caller free to fall back to displaying it verbatim.
 */
export function isoDurationToMillis(duration: string): number | undefined {
  const match: RegExpMatchArray | null = duration.trim().match(ISO_DURATION_PATTERN);
  if (!match) {
    return undefined;
  }

  const [, days, hours, minutes, seconds] = match;
  if (days === undefined && hours === undefined && minutes === undefined && seconds === undefined) {
    // bare "P" or "PT" carries no duration at all
    return undefined;
  }

  return (
    Number(days ?? 0) * MILLIS_PER_DAY +
    Number(hours ?? 0) * MILLIS_PER_HOUR +
    Number(minutes ?? 0) * MILLIS_PER_MINUTE +
    Number(seconds ?? 0) * MILLIS_PER_SECOND
  );
}

/**
 * Render an ISO 8601 duration string for display, falling back to the raw string when it isn't in a
 * form we can parse (better to show CCloud's value verbatim than to hide it).
 */
export function formatIsoDuration(duration: string): string {
  const millis: number | undefined = isoDurationToMillis(duration);
  return millis === undefined ? duration : formatDurationMillis(millis);
}
