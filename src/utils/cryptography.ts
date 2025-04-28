import { createHash } from "crypto";

/** Compute a hex-encoded SHA-256 hash of a client-side string to accompany telemetry data. */
export function hashed(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
