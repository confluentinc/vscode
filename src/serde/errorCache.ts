/**
 * Error Cache for Schema Registry failures.
 *
 * Caches schema fetch errors to avoid repeatedly hammering Schema Registry
 * when the same schema ID fails (e.g., schema not found, auth errors).
 * Uses a 30-second TTL to allow recovery from transient failures.
 */

/** Default TTL for cached errors in milliseconds. */
const DEFAULT_ERROR_TTL_MS = 30_000;

/** Cached error entry. */
interface CachedError {
  message: string;
  timestamp: number;
}

/**
 * Cache for Schema Registry errors.
 *
 * Keys are in format "connectionId:schemaId" to isolate errors
 * between different connections.
 */
class ErrorCache {
  private readonly cache = new Map<string, CachedError>();
  private readonly ttlMs: number;

  constructor(ttlMs: number = DEFAULT_ERROR_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  /**
   * Gets a cached error for a schema ID.
   * @param connectionId Connection identifier.
   * @param schemaId Schema ID that failed.
   * @returns Error message if cached and not expired, null otherwise.
   */
  getError(connectionId: string, schemaId: number): string | null {
    const key = this.makeKey(connectionId, schemaId);
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check if expired
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }

    return entry.message;
  }

  /**
   * Caches an error for a schema ID.
   * @param connectionId Connection identifier.
   * @param schemaId Schema ID that failed.
   * @param message Error message to cache.
   */
  setError(connectionId: string, schemaId: number, message: string): void {
    const key = this.makeKey(connectionId, schemaId);
    this.cache.set(key, {
      message,
      timestamp: Date.now(),
    });
  }

  /**
   * Clears all cached errors for a connection.
   * @param connectionId Connection identifier.
   */
  clearConnection(connectionId: string): void {
    const prefix = `${connectionId}:`;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clears all cached errors.
   */
  clear(): void {
    this.cache.clear();
  }

  private makeKey(connectionId: string, schemaId: number): string {
    return `${connectionId}:${schemaId}`;
  }
}

/** Singleton instance of the error cache. */
let instance: ErrorCache | null = null;

/**
 * Gets the singleton error cache instance.
 * @returns The error cache instance.
 */
export function getErrorCache(): ErrorCache {
  if (!instance) {
    instance = new ErrorCache();
  }
  return instance;
}

/**
 * Resets the error cache (primarily for testing).
 */
export function resetErrorCache(): void {
  instance = null;
}
