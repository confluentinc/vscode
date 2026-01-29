/**
 * Error types for Kafka Admin operations.
 */

/**
 * Error categories for retry classification.
 */
export enum KafkaAdminErrorCategory {
  /** Transient error that may succeed on retry (network issues, broker unavailable). */
  TRANSIENT = "TRANSIENT",
  /** Authorization or authentication failure (no retry will help). */
  AUTH = "AUTH",
  /** Invalid request or configuration (no retry will help). */
  INVALID = "INVALID",
  /** Resource not found. */
  NOT_FOUND = "NOT_FOUND",
  /** Resource already exists. */
  ALREADY_EXISTS = "ALREADY_EXISTS",
  /** Unknown or unclassified error. */
  UNKNOWN = "UNKNOWN",
}

/**
 * Error class for Kafka Admin operations.
 *
 * Wraps kafkajs errors with additional classification for retry logic.
 */
export class KafkaAdminError extends Error {
  /** Error category for retry classification. */
  readonly category: KafkaAdminErrorCategory;
  /** Original error that caused this error. */
  readonly cause?: Error;
  /** Whether this error is potentially retryable. */
  readonly retryable: boolean;

  constructor(
    message: string,
    category: KafkaAdminErrorCategory,
    options?: { cause?: Error; retryable?: boolean },
  ) {
    super(message);
    this.name = "KafkaAdminError";
    this.category = category;
    this.cause = options?.cause;
    // Default retryable based on category
    this.retryable = options?.retryable ?? category === KafkaAdminErrorCategory.TRANSIENT;
  }

  /**
   * Creates a KafkaAdminError from a kafkajs error.
   * @param error The original error.
   * @returns A KafkaAdminError with appropriate classification.
   */
  static fromKafkaJsError(error: Error): KafkaAdminError {
    const message = error.message || String(error);
    const category = classifyKafkaJsError(error);

    return new KafkaAdminError(message, category, { cause: error });
  }
}

/**
 * Classifies a kafkajs error into a category for retry logic.
 * @param error The error to classify.
 * @returns The error category.
 */
function classifyKafkaJsError(error: Error): KafkaAdminErrorCategory {
  const message = error.message?.toLowerCase() || "";
  const name = error.name || "";

  // Authentication/Authorization errors
  if (
    name === "KafkaJSSASLAuthenticationError" ||
    message.includes("authentication") ||
    message.includes("sasl") ||
    message.includes("unauthorized") ||
    message.includes("not authorized") ||
    message.includes("acl")
  ) {
    return KafkaAdminErrorCategory.AUTH;
  }

  // Not found errors
  if (
    name === "KafkaJSUnknownTopicError" ||
    message.includes("unknown topic") ||
    message.includes("topic not found") ||
    message.includes("does not exist")
  ) {
    return KafkaAdminErrorCategory.NOT_FOUND;
  }

  // Already exists errors
  if (
    name === "KafkaJSTopicAlreadyExists" ||
    message.includes("already exists") ||
    message.includes("topic with this name already exists")
  ) {
    return KafkaAdminErrorCategory.ALREADY_EXISTS;
  }

  // Invalid request errors
  if (
    name === "KafkaJSInvalidTopic" ||
    message.includes("invalid") ||
    message.includes("illegal") ||
    message.includes("bad request")
  ) {
    return KafkaAdminErrorCategory.INVALID;
  }

  // Transient/connection errors
  if (
    name === "KafkaJSConnectionError" ||
    name === "KafkaJSBrokerNotFound" ||
    name === "KafkaJSConnectionClosedError" ||
    name === "KafkaJSRequestTimeoutError" ||
    name === "KafkaJSNumberOfRetriesExceeded" ||
    message.includes("connection") ||
    message.includes("timeout") ||
    message.includes("broker") ||
    message.includes("not available") ||
    message.includes("network")
  ) {
    return KafkaAdminErrorCategory.TRANSIENT;
  }

  return KafkaAdminErrorCategory.UNKNOWN;
}
