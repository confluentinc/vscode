/**
 * Warning parsing utilities for Flink statements.
 * Handles both new structured API warnings and legacy [Warning] format in detail strings.
 */

import type { SqlV1StatementWarning } from "../clients/flinkSql";

/** Regex matching `[Warning] message` blocks in legacy detail strings. */
const LEGACY_WARNING_PATTERN = /\[Warning\]\s*([\s\S]*?)(?=\s*\[Warning\]|$)/gi;

/**
 * Parse legacy [Warning] format from detail string.
 * Legacy format: "[Warning] message. [Warning] another message."
 * @param detail The detail string that may contain legacy warnings
 * @returns Array of warnings coerced to match SqlV1StatementWarning object type
 */
export function parseLegacyWarnings(detail: string | undefined): SqlV1StatementWarning[] {
  if (!detail) {
    return [];
  }

  const warnings: SqlV1StatementWarning[] = [];
  LEGACY_WARNING_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = LEGACY_WARNING_PATTERN.exec(detail)) !== null) {
    const message = match[1].trim();
    if (message) {
      warnings.push({
        severity: "MODERATE",
        created_at: new Date(0), // No timestamp in legacy format - default to epoch sentinel
        reason: "", // No reason in legacy format
        message,
      });
    }
  }

  return warnings;
}

/**
 * Extract warnings from API response, preferring structured warnings over legacy parsing.
 * @param warnings The structured warnings array from the API (may be undefined)
 * @param detail The detail string that may contain legacy warnings
 * @returns Array of parsed SqlV1StatementWarning objects
 */
export function extractWarnings(
  warnings: SqlV1StatementWarning[] | undefined,
  detail: string | undefined,
): SqlV1StatementWarning[] {
  // Prefer structured warnings if available
  if (warnings && warnings.length > 0) {
    return warnings;
  }

  // Fall back to legacy parsing
  return parseLegacyWarnings(detail);
}

/**
 * Strip [Warning] sections from a detail string.
 * Used to avoid duplication when API warnings are displayed separately.
 * @param detail The detail string that may contain legacy warnings
 * @returns The detail string with [Warning] sections removed, or null if only warnings remain
 */
export function stripWarningsFromDetail(detail: string | undefined): string | null {
  if (!detail) {
    return null;
  }
  LEGACY_WARNING_PATTERN.lastIndex = 0;
  const stripped = detail.replace(LEGACY_WARNING_PATTERN, "").trim();
  return stripped.length > 0 ? stripped : null;
}
