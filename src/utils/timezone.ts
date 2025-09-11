/**
 * Get the user's local timezone offset.
 * @returns The local timezone offset in the format "GMT+/-HHMM", e.g. "GMT-0400" for EDT.
 */
export function localTimezoneOffset(): string {
  const nowStr = new Date().toString();
  return nowStr.match(/([A-Z]+[+-]\d+)/)![1]; //NOSONAR: This regex is safe for parsing the timezone offset from a date string.
}
