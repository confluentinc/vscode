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
const throttledEvents: Record<string, boolean> = {};

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
      const msg = event.message || hint?.originalException?.message || undefined;
      // if message is undefined we will always send the event
      if (msg) {
        if (msg in throttledEvents) {
          // do not send event if we already sent same msg in the last 1 minute
          logger.debug("Rate limiting activated for", msg);
          return null;
        }
        throttledEvents[msg] = true;
        setTimeout(() => {
          if (msg) {
            delete throttledEvents[msg];
          }
        }, 60000); // clear after 1 minute
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
  const scope = getSentryScope();
  const client = scope.getClient();
  if (!client) {
    logger.error("No Sentry client available");
    return ex;
  }

  logger.debug("Sending exception to Sentry", { ex, hint });
  scope.captureException(ex, hint);
  return ex;
}

export async function closeSentryClient() {
  await getSentryScope().getClient()?.close(2000);
}
