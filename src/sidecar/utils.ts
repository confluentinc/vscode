/**
 * Pause for MOMENTARY_PAUSE_MS.
 */
export async function pause(delay: number): Promise<void> {
  // pause an iota
  await new Promise((timeout_resolve) => setTimeout(timeout_resolve, delay));
}
