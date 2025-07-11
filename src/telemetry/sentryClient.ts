import {
  EventHint,
  NodeClient,
  Scope,
  defaultStackParser,
  getDefaultIntegrations,
  makeNodeTransport,
  rewriteFramesIntegration,
} from "@sentry/node";
import { Logger } from "../logging";
import { checkTelemetrySettings, includeObservabilityContext } from "./eventProcessors";

const logger = new Logger("sentry");
let sentryScope: Scope | null = null;
let sentryClient: NodeClient | null = null;
const DEFAULT_RATE_LIMIT = 100; // Maximum events per minute
let sentryEventCount = 0;
let sentryLastResetTime = Date.now();

/**
 * Returns the Sentry Scope singleton, creating it if it doesn't exist
 */
export function getSentryScope(): Scope {
  if (!sentryScope) {
    logger.debug("Creating new Sentry scope");
    sentryScope = new Scope();
  }
  return sentryScope;
}

/**
 * Initialize Sentry for error tracking. Manually setup Sentry client to avoid polluting global scope.
 * @see https://docs.sentry.io/platforms/javascript/best-practices/shared-environments/#shared-environment-setup
 * @see https://docs.sentry.io/platforms/node/
 */
export function initSentry() {
  if (sentryClient) {
    logger.debug("Sentry already initialized");
    return;
  }
  // filter out integrations that use the global variable
  const integrations = getDefaultIntegrations({}).filter((defaultIntegration) => {
    return ![
      "Breadcrumbs",
      "BrowserAPIErrors",
      "OnUnhandledRejection",
      "OnUncaughtException",
      "CaptureConsole",
    ].includes(defaultIntegration.name);
  });

  sentryClient = new NodeClient({
    // debug: true, // enable for local "prod" debugging with dev console
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENV,
    release: process.env.SENTRY_RELEASE,
    integrations: [...integrations, rewriteFramesIntegration()],
    tracesSampleRate: 0, // We do not use Sentry tracing
    profilesSampleRate: 0, // We do not use Sentry profiling
    sampleRate: 1.0,
    attachStacktrace: true,
    includeLocalVariables: true,
    transport: makeNodeTransport,
    stackParser: defaultStackParser,
    ignoreErrors: ["Canceled"],
  });

  const scope = getSentryScope();
  scope.setClient(sentryClient);
  scope.addEventProcessor(checkTelemetrySettings);
  scope.addEventProcessor(includeObservabilityContext);

  sentryClient.init();
}

/**
 * Checks if we should send the current error to Sentry based on DEFAULT_RATE_LIMIT.
 * Resets the counter every minute and tracks error event frequency.
 *
 * @returns boolean True if the error should be sent, False if rate limited
 */
function shouldSendToSentry(): boolean {
  const now = Date.now();
  const oneMinuteMs = 60 * 1000;

  // Reset counter if a minute has passed since the last reset
  if (now - sentryLastResetTime > oneMinuteMs) {
    sentryEventCount = 0;
    sentryLastResetTime = now;
  }

  sentryEventCount++;
  if (sentryEventCount > DEFAULT_RATE_LIMIT) {
    // Only log this one time when we first hit the limit after a reset
    if (sentryEventCount === DEFAULT_RATE_LIMIT + 1) {
      logger.warn(
        `Sentry rate limit of ${DEFAULT_RATE_LIMIT} events per minute exceeded. Errors will not be sent to Sentry for the next minute.`,
      );
    }
    return false;
  }

  return true;
}

export function sentryCaptureException(ex: unknown, hint?: EventHint | undefined): unknown {
  const scope = getSentryScope();
  const client = scope.getClient();
  if (!client) {
    logger.error("No Sentry client available");
    return ex;
  }

  if (!shouldSendToSentry()) {
    // Still log locally but don't send to Sentry
    logger.debug("Rate limited: not sending exception to Sentry", { ex, hint });
    return ex;
  }

  logger.debug("Sending exception to Sentry", { ex, hint });
  scope.captureException(ex, hint);
  return ex;
}

export async function closeSentryClient() {
  await getSentryScope().getClient()?.close(2000);
}
