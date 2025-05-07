/**
 * Utility function to retry an assertion until it succeeds or times out.
 * @param callback - The assertion callback that might throw an AssertionError
 * @param message - Optional custom error message
 * @param timeout - Optional timeout in milliseconds (default: 5000ms)
 */
export async function eventually<T>(
  callback: () => T | Promise<T>,
  message?: string,
  timeout_ms: number = 5000,
  delay_ms: number = 15,
): Promise<T> {
  const startTime = Date.now();

  while (true) {
    try {
      return await callback();
    } catch (error) {
      if (error instanceof Error && error.name !== "AssertionError") {
        throw error;
      }
      if (Date.now() - startTime >= timeout_ms) {
        // Timeout reached - throw the last error with custom message if provided
        throw new Error(
          message ||
            `Assertion failed after ${timeout_ms}ms: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, delay_ms));
    }
  }
}
