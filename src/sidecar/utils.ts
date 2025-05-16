import { SidecarLogFormat, SidecarStartupFailureReason } from "./types";

/**
 * Pause for MOMENTARY_PAUSE_MS.
 */
export async function pause(delay: number): Promise<void> {
  // pause an iota
  await new Promise((timeout_resolve) => setTimeout(timeout_resolve, delay));
}

export function divineSidecarStartupFailureReasonFromLogs(
  platform: NodeJS.Platform,
  sidecarLogs: SidecarLogFormat[],
): SidecarStartupFailureReason {
  // Check for the presence of specific error messages in the logs
  if (sidecarLogs.some((log) => /seems to be in use by another process/.test(log.message))) {
    return SidecarStartupFailureReason.PORT_IN_USE;
  }
  // If no specific error messages are found, return UNKNOWN
  return SidecarStartupFailureReason.UNKNOWN;
}
