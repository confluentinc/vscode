import {
  Event,
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
const throttledEvents: Record<string, number> = {};

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
    beforeSend: (event, hint) => {
      // throttle events to prevent spamming Sentry with the same error more than once per minute
      const msg = event.message || (hint?.originalException as Error)?.message;
      if (msg) {
        const now = Date.now();
        const lastSent = throttledEvents[msg];
        if (lastSent && now - lastSent < 60_000) {
          logger.debug("Rate limiting activated for", msg);
          return null;
        }
        throttledEvents[msg] = now;
      }
      return event;
    },
  });

  const scope = getSentryScope();
  scope.setClient(sentryClient);
  scope.addEventProcessor(checkTelemetrySettings);
  scope.addEventProcessor(includeObservabilityContext);

  sentryClient.init();
}

export function sentryCaptureException(ex: unknown, hint?: EventHint | undefined): unknown {
  return sentryCapture(ex, "exception", hint) as unknown;
}

export function sentryCaptureEvent(event: Event, hint?: EventHint | undefined): Event {
  return sentryCapture(event, "event", hint) as Event;
}

export function sentryCapture(
  e: Event | unknown,
  kind: "event" | "exception",
  hint?: EventHint | undefined,
): Event | unknown {
  const scope = getSentryScope();
  const client = scope.getClient();
  if (!client) {
    logger.debug("No Sentry client available");
    return e;
  }

  logger.debug(`Sending ${kind} to Sentry`, { item: e, hint });
  switch (kind) {
    case "event":
      return scope.captureEvent(e as Event, hint);
    case "exception":
      return scope.captureException(e as unknown, hint);
    default:
      logger.error("Unknown kind for Sentry capture", { kind });
      return e;
  }
}

export async function closeSentryClient() {
  await getSentryScope().getClient()?.close(2000);
}
