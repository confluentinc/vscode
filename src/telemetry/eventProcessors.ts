import {
  EventHint,
  Event,
  NodeClient,
  Scope,
  defaultStackParser,
  getDefaultIntegrations,
  makeNodeTransport,
  rewriteFramesIntegration,
} from "@sentry/node";
import { env, workspace } from "vscode";
import { observabilityContext } from "../context/observability";
import { configDotenv } from "dotenv";
import { Logger } from "../logging";

/**
 * Initialize Sentry for error tracking (and future performance monitoring?).
 * Manually setup Sentry client to avoid polluting global scope.
 * @see https://docs.sentry.io/platforms/javascript/best-practices/shared-environments/#shared-environment-setup
 * @see https://docs.sentry.io/platforms/node/
 */
// Previous Sentry config for reference:
//     integrations: [
//       // https://docs.sentry.io/platforms/javascript/configuration/filtering/#using-thirdpartyerrorfilterintegration
//       SentryCore.thirdPartyErrorFilterIntegration({
//         filterKeys: ["confluent-vscode-extension-sentry-do-not-use"],
//         behaviour: "drop-error-if-exclusively-contains-third-party-frames",
//       }),
//       Sentry.rewriteFramesIntegration(),
//     ],
//     ignoreErrors: [
//       "The request failed and the interceptors did not return an alternative response",
//       "ENOENT: no such file or directory",
//       "EPERM: operation not permitted",
//       "Canceled",
//       // rejected promises from the CCloud auth provider that can't be wrapped in try/catch:
//       "User cancelled the authentication flow.",
//       "User reset their password.",
//       "Confluent Cloud authentication failed. See browser for details.",
//     ],

const logger = new Logger("sentry");

const SentryScope: Scope = new Scope();
configDotenv();
export function initSentry() {
  logger.debug("Initializing Sentry");
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

  const client = new NodeClient({
    // debug: true, // enable for local "prod" debugging with dev console
    dsn: process.env.SENTRY_DSN,
    initialScope: {
      tags: { "my-tag": "my value" },
      user: { id: 42, email: "john.doe@example.com" },
    },
    environment: process.env.SENTRY_ENV,
    release: process.env.SENTRY_RELEASE,
    integrations: [...integrations, rewriteFramesIntegration()],
    beforeSend(event) {
      logger.debug(`Sentry beforeSend: ${JSON.stringify(event?.exception?.values)}`);
      return event;
    },
    tracesSampleRate: 0, // We do not use Sentry tracing
    profilesSampleRate: 0, // We do not use Sentry profiling
    sampleRate: 1.0,
    attachStacktrace: true,
    includeLocalVariables: true,
    transport: makeNodeTransport,
    stackParser: defaultStackParser,
  });
  SentryScope.setTag("extension", "vscode-confluent");
  SentryScope.setClient(client);
  SentryScope.addEventProcessor(checkTelemetrySettings);
  SentryScope.addEventProcessor(includeObservabilityContext);
  client.init();
}

export function sentryCaptureException(ex: unknown, hint?: EventHint | undefined): unknown {
  // TODO NC remove debug logs
  logger.debug("Attempting to send to Sentry:", ex);
  const client = SentryScope.getClient();
  if (!client) {
    logger.error("No Sentry client available");
    return ex;
  }
  logger.debug(`Sending to Sentry with DSN: ${process.env.SENTRY_DSN?.substring(0, 5)}...`);
  SentryScope.captureException(ex, hint);
  logger.debug("Sent to Sentry");
  return ex;
}

export async function closeSentryClient() {
  await SentryScope.getClient()?.close(2000);
}
/** Helper function to make sure the user has Telemetry ON before sending Sentry error events */
function checkTelemetrySettings(event: Event) {
  const telemetryLevel = workspace.getConfiguration()?.get("telemetry.telemetryLevel");
  if (!env.isTelemetryEnabled || telemetryLevel === "off") {
    // Returning `null` will drop the event
    return null;
  }
  return event;
}

/** Include this extension instance's {@link observabilityContext} under the `extra` context. */
function includeObservabilityContext(event: Event): Event {
  event.extra = { ...event.extra, ...observabilityContext.toRecord() };
  return event;
}
