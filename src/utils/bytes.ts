/**
 * Binary units, labeled the way VS Code's own UI labels them (KB for 1024 bytes, not KiB).
 */
const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;
const BYTES_PER_UNIT = 1024;

/**
 * Render a byte count for display, e.g. `947 B`, `12.3 KB`, `1.8 MB`.
 *
 * @param bytes Number of bytes. Negative and non-finite values render as `0 B`.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  let unitIndex = 0;
  let value = bytes;
  while (value >= BYTES_PER_UNIT && unitIndex < BYTE_UNITS.length - 1) {
    value /= BYTES_PER_UNIT;
    unitIndex++;
  }

  // whole bytes never need a decimal point; larger units read better with one
  const rendered: string = unitIndex === 0 ? Math.round(value).toString() : value.toFixed(1);
  return `${rendered} ${BYTE_UNITS[unitIndex]}`;
}

/**
 * Approximate the UTF-8 byte size of a value as it arrived over the wire, by re-serializing it.
 *
 * Only ever an estimate: the generated API clients hand back parsed JSON, so the original response
 * body — with its whitespace and key ordering — is gone by the time we can see the value.
 *
 * @returns Byte count, or 0 for values JSON can't represent.
 */
export function estimateJsonBytes(value: unknown): number {
  const json: string | undefined = JSON.stringify(value);
  return json === undefined ? 0 : new TextEncoder().encode(json).length;
}
