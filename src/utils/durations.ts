const MILLIS_PER_SECOND = 1000;
const MILLIS_PER_MINUTE = 60 * MILLIS_PER_SECOND;
const MILLIS_PER_HOUR = 60 * MILLIS_PER_MINUTE;
const MILLIS_PER_DAY = 24 * MILLIS_PER_HOUR;

/** A single leading `<number><unit>` component of an ISO 8601 duration, e.g. `30S` or `1.5S`. */
const DURATION_COMPONENT = /^(\d+(?:\.\d+)?)([A-Z])/;

/**
 * The components CCloud actually emits, listed in the order ISO 8601 requires them to appear within
 * their section. Days and below only: anything longer is ambiguous in milliseconds, and `M` means
 * months before the `T` but minutes after it, so the two sections are kept deliberately separate.
 */
const DATE_UNIT_MILLIS: ReadonlyArray<[string, number]> = [["D", MILLIS_PER_DAY]];
const TIME_UNIT_MILLIS: ReadonlyArray<[string, number]> = [
  ["H", MILLIS_PER_HOUR],
  ["M", MILLIS_PER_MINUTE],
  ["S", MILLIS_PER_SECOND],
];

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
  const trimmed: string = duration.trim();
  if (!trimmed.startsWith("P")) {
    return undefined;
  }

  // everything before the "T" is the date section, everything after it the time section
  const sections: string[] = trimmed.slice(1).split("T");
  if (sections.length > 2) {
    return undefined;
  }

  const date = parseDurationSection(sections[0], DATE_UNIT_MILLIS);
  const time = parseDurationSection(sections[1] ?? "", TIME_UNIT_MILLIS);
  if (date === undefined || time === undefined) {
    return undefined;
  }
  if (date.count + time.count === 0) {
    // bare "P" or "PT" carries no duration at all
    return undefined;
  }

  return date.millis + time.millis;
}

/**
 * Render an ISO 8601 duration string for display, falling back to the raw string when it isn't in a
 * form we can parse (better to show CCloud's value verbatim than to hide it).
 */
export function formatIsoDuration(duration: string): string {
  const millis: number | undefined = isoDurationToMillis(duration);
  return millis === undefined ? duration : formatDurationMillis(millis);
}

/**
 * Consume `<number><unit>` components from the front of one section of a duration, accumulating
 * their millisecond total.
 *
 * @param section The section's text, without its `P` or `T` marker. Empty means no components.
 * @param unitMillis The units allowed here, in the order they must appear.
 * @returns The section's total and how many components it held, or undefined if it contains anything
 *   other than a run of allowed components in order — an unknown unit, a repeat, or trailing text.
 */
function parseDurationSection(
  section: string,
  unitMillis: ReadonlyArray<[string, number]>,
): { millis: number; count: number } | undefined {
  let rest: string = section;
  let millis = 0;
  let count = 0;
  let nextUnit = 0;

  while (rest.length > 0) {
    const match: RegExpExecArray | null = DURATION_COMPONENT.exec(rest);
    if (match === null) {
      return undefined;
    }

    const [component, value, unit] = match;
    const unitIndex: number = unitMillis.findIndex(([name]) => name === unit);
    if (unitIndex < 0 || unitIndex < nextUnit) {
      // not a unit this section takes, or one that's out of order or repeated
      return undefined;
    }

    millis += Number(value) * unitMillis[unitIndex][1];
    nextUnit = unitIndex + 1;
    count++;
    rest = rest.slice(component.length);
  }

  return { millis, count };
}
