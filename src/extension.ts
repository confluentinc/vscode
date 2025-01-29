// Import this first!
import * as SentryCore from "@sentry/core";
import * as Sentry from "@sentry/node";
/**
 * Initialize Sentry for error tracking (and future performance monitoring?).
 * Sentry.init needs to be run first before any other code so that Sentry can capture all errors.
 * `process.env.SENTRY_DSN` is fetched & defined during production builds only for Confluent official release process
 *
 * @see https://docs.sentry.io/platforms/node/
 */
if (process.env.SENTRY_DSN) {
  Sentry.init({
    // debug: true, // enable for local "prod" debugging with dev console
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENV,
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: 0,
    profilesSampleRate: 0,
    integrations: [
      // https://docs.sentry.io/platforms/javascript/configuration/filtering/#using-thirdpartyerrorfilterintegration
      SentryCore.thirdPartyErrorFilterIntegration({
        filterKeys: ["confluent-vscode-extension-sentry-do-not-use"],
        behaviour: "drop-error-if-exclusively-contains-third-party-frames",
      }),
      Sentry.rewriteFramesIntegration(),
    ],
    ignoreErrors: [
      "The request failed and the interceptors did not return an alternative response",
      "ENOENT: no such file or directory",
      "EPERM: operation not permitted",
      "Canceled",
      "captureException", // only ever floated by the Sentry SDK itself
    ],
  });
}

import * as vscode from "vscode";
import { checkTelemetrySettings, includeObservabilityContext } from "./telemetry/eventProcessors";
if (process.env.SENTRY_DSN) {
  Sentry.addEventProcessor(checkTelemetrySettings);
  Sentry.addEventProcessor(includeObservabilityContext);
}

import { ConfluentCloudAuthProvider, getAuthProvider } from "./authn/ccloudProvider";
import { getCCloudAuthSession } from "./authn/utils";
import { registerCommandWithLogging } from "./commands";
import { registerConnectionCommands } from "./commands/connections";
import { registerDebugCommands } from "./commands/debugtools";
import { registerDiffCommands } from "./commands/diffs";
import { registerDockerCommands } from "./commands/docker";
import { registerEnvironmentCommands } from "./commands/environments";
import { registerExtraCommands } from "./commands/extra";
import { registerKafkaClusterCommands } from "./commands/kafkaClusters";
import { registerOrganizationCommands } from "./commands/organizations";
import { registerSchemaRegistryCommands } from "./commands/schemaRegistry";
import { registerSchemaCommands } from "./commands/schemas";
import { registerSupportCommands } from "./commands/support";
import { registerTopicCommands } from "./commands/topics";
import { AUTH_PROVIDER_ID, AUTH_PROVIDER_LABEL } from "./constants";
import { activateMessageViewer } from "./consume";
import { setExtensionContext } from "./context/extension";
import { observabilityContext } from "./context/observability";
import { ContextValues, setContextValue } from "./context/values";
import { DirectConnectionManager } from "./directConnectManager";
import { EventListener } from "./docker/eventListener";
import { MessageDocumentProvider } from "./documentProviders/message";
import { SchemaDocumentProvider } from "./documentProviders/schema";
import { constructResourceLoaderSingletons } from "./loaders";
import { Logger, outputChannel } from "./logging";
import {
  ENABLE_PRODUCE_MESSAGES,
  SSL_PEM_PATHS,
  SSL_VERIFY_SERVER_CERT_DISABLED,
} from "./preferences/constants";
import { createConfigChangeListener } from "./preferences/listener";
import { updatePreferences } from "./preferences/updates";
import { registerProjectGenerationCommand } from "./scaffold";
import { JSON_DIAGNOSTIC_COLLECTION } from "./schemas/diagnosticCollection";
import { getSidecarManager, sidecarOutputChannel } from "./sidecar";
import { ConnectionStateWatcher } from "./sidecar/connections/watcher";
import { WebsocketManager } from "./sidecar/websocketManager";
import { getStorageManager, StorageManager } from "./storage";
import { SecretStorageKeys } from "./storage/constants";
import { migrateStorageIfNeeded } from "./storage/migrationManager";
import { logUsage, UserEvent } from "./telemetry/events";
import { sendTelemetryIdentifyEvent } from "./telemetry/telemetry";
import { getTelemetryLogger } from "./telemetry/telemetryLogger";
import { getUriHandler } from "./uriHandler";
import { ResourceViewProvider } from "./viewProviders/resources";
import { SchemasViewProvider } from "./viewProviders/schemas";
import { SupportViewProvider } from "./viewProviders/support";
import { TopicViewProvider } from "./viewProviders/topics";

const logger = new Logger("extension");

// This method is called when your extension is activated based on the activation events
// defined in package.json
// ref: https://code.visualstudio.com/api/references/activation-events
export async function activate(
  context: vscode.ExtensionContext,
): Promise<vscode.ExtensionContext | undefined> {
  observabilityContext.extensionVersion = context.extension.packageJSON.version;
  observabilityContext.extensionActivated = false;

  logger.info(`Extension ${context.extension.id}" activate() triggered.`);
  try {
    context = await _activateExtension(context);
    logger.info("Extension fully activated");
    observabilityContext.extensionActivated = true;
  } catch (e) {
    logger.error("Error activating extension:", e);
    // if the extension is failing to activate for whatever reason, we need to know about it to fix it
    Sentry.captureException(e);
    throw e;
  }

  // XXX: used to provide the ExtensionContext for tests; do not remove
  if (context.extensionMode === vscode.ExtensionMode.Test) {
    return context;
  }
}

/**
 * Activate the extension by setting up all the necessary components and registering commands.
 * @remarks This is the try/catch wrapped function called from the extension's .activate() method
 * to ensure that any errors are caught and logged properly.
 */
async function _activateExtension(
  context: vscode.ExtensionContext,
): Promise<vscode.ExtensionContext> {
  logUsage(UserEvent.ExtensionActivated);

  // must be done first to allow any other downstream callers to call `getExtensionContext()`
  // (e.g. StorageManager for secrets/states, webviews for extension root path, etc)
  setExtensionContext(context);

  // register the log output channels and debugging commands before anything else, in case we need
  // to reset global/workspace state or there's a problem further down with extension activation
  context.subscriptions.push(outputChannel, sidecarOutputChannel, ...registerDebugCommands());
  // automatically display and focus the Confluent extension output channel in development mode
  // to avoid needing to keep the main window & Debug Console tab open alongside the extension dev
  // host window during debugging
  if (process.env.LOGGING_MODE === "development") {
    vscode.commands.executeCommand("confluent.showOutputChannel");
  }

  // configure the StorageManager for extension access to secrets and global/workspace states, and
  // set the initial context values for the VS Code UI to inform the `when` clauses in package.json
  await Promise.all([setupStorage(), setupContextValues()]);
  logger.info("Storage and context values initialized");

  // set up the preferences listener to keep the sidecar in sync with the user/workspace settings
  const settingsListener: vscode.Disposable = await setupPreferences();
  context.subscriptions.push(settingsListener);

  // set up the different view providers
  const resourceViewProvider = ResourceViewProvider.getInstance();
  const topicViewProvider = TopicViewProvider.getInstance();
  const schemasViewProvider = SchemasViewProvider.getInstance();
  const supportViewProvider = new SupportViewProvider();
  const viewProviderDisposables: vscode.Disposable[] = [
    ...resourceViewProvider.disposables,
    ...topicViewProvider.disposables,
    ...schemasViewProvider.disposables,
    ...supportViewProvider.disposables,
  ];
  logger.info("View providers initialized");
  // explicitly "reset" the Topics & Schemas views so no resources linger during reactivation/update
  topicViewProvider.reset();
  schemasViewProvider.reset();

  // register refresh commands for our primary resource view providers, which will fetch their
  // associated data from the sidecar instead of relying on any preloaded/cached data in ext. state
  const refreshCommands: vscode.Disposable[] = [
    registerCommandWithLogging("confluent.resources.refresh", () => {
      resourceViewProvider.refresh(true);
    }),
    registerCommandWithLogging("confluent.topics.refresh", () => {
      topicViewProvider.refresh(true);
    }),
    registerCommandWithLogging("confluent.schemas.refresh", () => {
      schemasViewProvider.refresh(true);
    }),
  ];

  // register all the commands (apart from the view providers' refresh commands, which are handled above)
  const registeredCommands: vscode.Disposable[] = [
    ...refreshCommands,
    ...registerConnectionCommands(),
    ...registerOrganizationCommands(),
    ...registerKafkaClusterCommands(),
    ...registerEnvironmentCommands(),
    ...registerSchemaRegistryCommands(),
    ...registerSchemaCommands(),
    ...registerSupportCommands(),
    ...registerTopicCommands(),
    ...registerDiffCommands(),
    ...registerExtraCommands(),
    ...registerDockerCommands(),
  ];
  logger.info("Commands registered");

  const uriHandler: vscode.Disposable = vscode.window.registerUriHandler(getUriHandler());
  const authProviderDisposables: vscode.Disposable[] = await setupAuthProvider();
  const documentProviders: vscode.Disposable[] = setupDocumentProviders();

  context.subscriptions.push(
    uriHandler,
    WebsocketManager.getInstance(),
    ...authProviderDisposables,
    ...viewProviderDisposables,
    ...registeredCommands,
    ...documentProviders,
  );

  // these are also just handling command registration and setting disposables
  activateMessageViewer(context);
  registerProjectGenerationCommand(context);

  // Construct the singletons, let them register their event listeners.
  context.subscriptions.push(...constructResourceLoaderSingletons());
  context.subscriptions.push(getSidecarManager());

  // set up the local Docker event listener singleton and start watching for system events
  EventListener.getInstance().start();
  // reset the Docker credentials secret so `src/docker/configs.ts` can pull it fresh
  getStorageManager().deleteSecret(SecretStorageKeys.DOCKER_CREDS_SECRET_KEY);

  // Watch for sidecar pushing connection state changes over websocket.
  // (side effect of causing the watcher to be created)
  ConnectionStateWatcher.getInstance();

  const directConnectionManager = DirectConnectionManager.getInstance();
  context.subscriptions.push(...directConnectionManager.disposables);

  // ensure our diagnostic collection(s) are cleared when the extension is deactivated
  context.subscriptions.push(JSON_DIAGNOSTIC_COLLECTION);

  // XXX: used for testing; do not remove
  return context;
}

/** Configure any starting contextValues to use for view/menu controls during activation. */
async function setupContextValues() {
  // PREVIEW: set default values for enabling the direct connection and message-produce features
  const config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration();
  const produceMessagesEnabled = setContextValue(
    ContextValues.produceMessagesEnabled,
    config.get(ENABLE_PRODUCE_MESSAGES, false),
  );
  // require re-selecting a cluster for the Topics/Schemas views on extension (re)start
  const kafkaClusterSelected = setContextValue(ContextValues.kafkaClusterSelected, false);
  const schemaRegistrySelected = setContextValue(ContextValues.schemaRegistrySelected, false);
  // constants for easier `when` clause matching in package.json; not updated dynamically
  const openInCCloudResources = setContextValue(ContextValues.CCLOUD_RESOURCES, [
    "ccloud-environment",
    "ccloud-kafka-cluster",
    "ccloud-kafka-topic",
    "ccloud-kafka-topic-with-schema",
    "ccloud-schema-registry",
  ]);
  // allow for easier matching using "in" clauses for our Resources/Topics/Schemas views
  const viewsWithResources = setContextValue(ContextValues.VIEWS_WITH_RESOURCES, [
    "confluent-resources",
    "confluent-topics",
    "confluent-schemas",
  ]);
  // enables the "Copy ID" command; these resources must have the "id" property
  const resourcesWithIds = setContextValue(ContextValues.RESOURCES_WITH_ID, [
    "ccloud-environment", // direct/local environments only have internal IDs
    "ccloud-kafka-cluster",
    "ccloud-schema-registry", // only ID, no name
    "local-kafka-cluster",
    "local-schema-registry",
    "direct-kafka-cluster",
    "direct-schema-registry",
  ]);
  const resourcesWithNames = setContextValue(ContextValues.RESOURCES_WITH_NAMES, [
    "ccloud-environment",
    "ccloud-kafka-cluster",
    "local-kafka-cluster",
    "direct-kafka-cluster",
    // topics also have names, but their context values vary wildly and must be regex-matched
  ]);
  const resourcesWithURIs = setContextValue(ContextValues.RESOURCES_WITH_URIS, [
    "ccloud-kafka-cluster",
    "ccloud-schema-registry",
    "local-kafka-cluster",
    "local-schema-registry",
    "direct-schema-registry",
  ]);
  await Promise.all([
    produceMessagesEnabled,
    kafkaClusterSelected,
    schemaRegistrySelected,
    openInCCloudResources,
    viewsWithResources,
    resourcesWithIds,
    resourcesWithNames,
    resourcesWithURIs,
  ]);
}

/**
 * Pass initial {@link vscode.WorkspaceConfiguration} settings to the sidecar's Preferences API on
 * startup to ensure the sidecar is in sync with the extension's settings before other requests are made.
 * @returns A {@link vscode.Disposable} for the extension settings listener
 */
async function setupPreferences(): Promise<vscode.Disposable> {
  // pass initial configs to the sidecar on startup
  const configs: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration();
  const pemPaths: string[] = configs.get(SSL_PEM_PATHS, []);
  const trustAllCerts: boolean = configs.get(SSL_VERIFY_SERVER_CERT_DISABLED, false);
  await updatePreferences({ tls_pem_paths: pemPaths, trust_all_certificates: trustAllCerts });
  logger.info("Initial preferences passed to sidecar");
  return createConfigChangeListener();
}

/** Initialize the StorageManager singleton instance and handle any necessary migrations. */
async function setupStorage(): Promise<void> {
  const manager = StorageManager.getInstance();
  // Handle any storage migrations that need to happen before the extension can proceed.
  await migrateStorageIfNeeded(manager);
  logger.info("Storage manager initialized and migrations completed");
}

/**
 * Register the Confluent Cloud authentication provider with the VS Code authentication API, set up
 * the initial connection state context values, and attempt to get a session to trigger the initial
 * auth badge for signing in.
 * @returns A {@link vscode.Disposable} for the auth provider
 */
async function setupAuthProvider(): Promise<vscode.Disposable[]> {
  const provider: ConfluentCloudAuthProvider = getAuthProvider();
  const providerDisposable = vscode.authentication.registerAuthenticationProvider(
    AUTH_PROVIDER_ID,
    AUTH_PROVIDER_LABEL,
    provider,
    {
      supportsMultipleAccounts: false, // this is the default, but just to be explicit
    },
  );

  // set the initial connection states of our main views; these will be adjusted by the following:
  // - ccloudConnectionAvailable: `true/false` if the auth provider has a valid CCloud connection
  // - localKafkaClusterAvailable: `true/false` if the Resources view loads/refreshes and we can
  //  discover a local Kafka cluster
  // - localSchemaRegistryAvailable: `true/false` if the Resources view loads/refreshes and we can
  //  discover a local Schema Registry
  await Promise.all([
    setContextValue(ContextValues.ccloudConnectionAvailable, false),
    setContextValue(ContextValues.localKafkaClusterAvailable, false),
    setContextValue(ContextValues.localSchemaRegistryAvailable, false),
  ]);

  // attempt to get a session to trigger the initial auth badge for signing in
  const cloudSession = await getCCloudAuthSession();

  // Send an Identify event to Segment with the session info if available
  if (cloudSession) {
    sendTelemetryIdentifyEvent({
      eventName: UserEvent.ActivatedWithSession,
      userInfo: undefined,
      session: cloudSession,
    });
  }

  logger.info("Confluent Cloud auth provider registered");
  return [providerDisposable, ...provider.disposables];
}

/** Set up the document providers for custom URI schemes. */
function setupDocumentProviders(): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];
  // any document providers set here must provide their own `scheme` to register with
  const providerClasses = [SchemaDocumentProvider, MessageDocumentProvider];
  for (const providerClass of providerClasses) {
    const provider = new providerClass();
    disposables.push(
      vscode.workspace.registerTextDocumentContentProvider(provider.scheme, provider),
    );
  }
  logger.info("Document providers registered");
  return disposables;
}

// This method is called when your extension is deactivated or when VSCode is shutting down
export function deactivate() {
  getTelemetryLogger().dispose();

  logger.info("Extension deactivated");
}
