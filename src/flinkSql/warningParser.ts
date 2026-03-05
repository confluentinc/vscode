/**
 * Warning parsing utilities for Flink statements.
 * Handles both new structured API warnings and legacy [Warning] format in detail strings.
 */

/** Regex matching `[Warning] message` blocks in legacy detail strings. */
const LEGACY_WARNING_PATTERN = /\[Warning\]\s*([\s\S]*?)(?=\s*\[Warning\]|$)/gi;

/** API warning shape from the new structured warnings field */
export interface StatementWarning {
  readonly severity: string;
  readonly created_at: Date | null;
  readonly reason: string;
  readonly message: string;
}

/**
 * Parse legacy [Warning] format from detail string.
 * Legacy format: "[Warning] message. [Warning] another message."
 * @param detail The detail string that may contain legacy warnings
 * @returns Array of parsed StatementWarning objects
 */
export function parseLegacyWarnings(detail: string | undefined): StatementWarning[] {
  if (!detail) {
    return [];
  }

  const warnings: StatementWarning[] = [];
  LEGACY_WARNING_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = LEGACY_WARNING_PATTERN.exec(detail)) !== null) {
    const message = match[1].trim();
    if (message) {
      warnings.push({
        severity: "MODERATE",
        created_at: null, // No timestamp in legacy format
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
 * @returns Array of parsed StatementWarning objects
 */
export function extractWarnings(
  warnings: StatementWarning[] | undefined,
  detail: string | undefined,
): StatementWarning[] {
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
