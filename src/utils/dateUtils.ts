/**
 * Converts epoch milliseconds timestamp to datetime-local format (`YYYY-MM-DDTHH:mm:ss.sss`).
 * (Opposite of {@link datetimeLocalToTimestamp})
 */
export function timestampToDatetimeLocal(timestamp: number): string {
  // NOTE: Date methods automatically convert to browser's local timezone
  const date = new Date(timestamp);

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  const milliseconds = String(date.getMilliseconds()).padStart(3, "0");
  // YYYY-MM-DDTHH:mm:ss.sss
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}`;
}

// this is mainly for symmetry; we could just as easily use `new Date(datetimeLocal).getTime()`
/**
 * Converts datetime-local format (`YYYY-MM-DDTHH:mm:ss.sss`) to epoch milliseconds.
 * (Opposite of {@link timestampToDatetimeLocal})
 */
export function datetimeLocalToTimestamp(datetimeLocal: string): number {
  // NOTE: Date constructor automatically interprets input as local time
  const date = new Date(datetimeLocal);
  return date.getTime();
}
