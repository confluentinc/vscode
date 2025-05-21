import * as vscode from "vscode";
/** First things first, setup Sentry to catch errors during activation and beyond
 * `process.env.SENTRY_DSN` is fetched & defined during production builds only for Confluent official release process
 * */
import { closeSentryClient, initSentry } from "./telemetry/sentryClient";
if (process.env.SENTRY_DSN) {
  initSentry();
}

import { ConfluentCloudAuthProvider, getAuthProvider } from "./authn/ccloudProvider";
import { getCCloudAuthSession } from "./authn/utils";
import { disableCCloudStatusPolling, enableCCloudStatusPolling } from "./ccloudStatus/polling";
import { PARTICIPANT_ID } from "./chat/constants";
import { chatHandler } from "./chat/participant";
import { handleFeedback } from "./chat/telemetry";
import { registerChatTools } from "./chat/tools/registration";
import { FlinkSqlCodelensProvider } from "./codelens/flinkSqlProvider";
import { registerCommandWithLogging } from "./commands";
import { registerConnectionCommands } from "./commands/connections";
import { registerDebugCommands } from "./commands/debugtools";
import { registerDiffCommands } from "./commands/diffs";
import { registerDockerCommands } from "./commands/docker";
import { registerDocumentCommands } from "./commands/documents";
import { registerEnvironmentCommands } from "./commands/environments";
import { registerExtraCommands } from "./commands/extra";
import { registerFlinkComputePoolCommands } from "./commands/flinkComputePools";
import { registerFlinkStatementCommands } from "./commands/flinkStatements";
import { registerKafkaClusterCommands } from "./commands/kafkaClusters";
import { registerOrganizationCommands } from "./commands/organizations";
import { registerSchemaRegistryCommands } from "./commands/schemaRegistry";
import { registerSchemaCommands } from "./commands/schemas";
import { registerSupportCommands } from "./commands/support";
import { registerTopicCommands } from "./commands/topics";
import { AUTH_PROVIDER_ID, AUTH_PROVIDER_LABEL, IconNames } from "./constants";
import { activateMessageViewer } from "./consume";
import { setExtensionContext } from "./context/extension";
import { observabilityContext } from "./context/observability";
import { ContextValues, setContextValue } from "./context/values";
import { DirectConnectionManager } from "./directConnectManager";
import { EventListener } from "./docker/eventListener";
import { registerLocalResourceWorkflows } from "./docker/workflows/workflowInitialization";
import { DocumentMetadataManager } from "./documentMetadataManager";
import { FlinkStatementDocumentProvider } from "./documentProviders/flinkStatement";
import { MESSAGE_URI_SCHEME, MessageDocumentProvider } from "./documentProviders/message";
import { SCHEMA_URI_SCHEME, SchemaDocumentProvider } from "./documentProviders/schema";
import { logError } from "./errors";
import {
  disposeLaunchDarklyClient,
  getLaunchDarklyClient,
  resetFlagDefaults,
} from "./featureFlags/client";
import {
  checkForExtensionDisabledReason,
  showExtensionDisabledNotification,
} from "./featureFlags/evaluation";
import { initializeFlinkLanguageClientManager } from "./flinkSql/flinkLanguageClientManager";
import { FlinkStatementManager } from "./flinkSql/flinkStatementManager";
import { activateFlinkStatementResultsViewer } from "./flinkStatementResults";
import { constructResourceLoaderSingletons } from "./loaders";
import { cleanupOldLogFiles, getLogFileStream, Logger, OUTPUT_CHANNEL } from "./logging";
import { ENABLE_CHAT_PARTICIPANT, ENABLE_FLINK } from "./preferences/constants";
import { createConfigChangeListener } from "./preferences/listener";
import { updatePreferences } from "./preferences/sidecarSync";
import { registerProjectGenerationCommands, setProjectScaffoldListener } from "./scaffold";
import { JSON_DIAGNOSTIC_COLLECTION } from "./schemas/diagnosticCollection";
import { getSidecar, getSidecarManager } from "./sidecar";
import { ConnectionStateWatcher } from "./sidecar/connections/watcher";
import { SIDECAR_OUTPUT_CHANNEL } from "./sidecar/logging";
import { WebsocketManager } from "./sidecar/websocketManager";
import { getCCloudStatusBarItem } from "./statusBar/ccloudItem";
import { SecretStorageKeys } from "./storage/constants";
import { migrateStorageIfNeeded } from "./storage/migrationManager";
import { logUsage, UserEvent } from "./telemetry/events";
import { sentryCaptureException } from "./telemetry/sentryClient";
import { sendTelemetryIdentifyEvent } from "./telemetry/telemetry";
import { getTelemetryLogger } from "./telemetry/telemetryLogger";
import { getUriHandler } from "./uriHandler";
import { WriteableTmpDir } from "./utils/file";
import { RefreshableTreeViewProvider } from "./viewProviders/base";
import { FlinkArtifactsViewProvider } from "./viewProviders/flinkArtifacts";
import { FlinkStatementsViewProvider } from "./viewProviders/flinkStatements";
import { ResourceViewProvider } from "./viewProviders/resources";
import { SchemasViewProvider } from "./viewProviders/schemas";
import { SEARCH_DECORATION_PROVIDER } from "./viewProviders/search";
import { SupportViewProvider } from "./viewProviders/support";
import { TopicViewProvider } from "./viewProviders/topics";

const logger = new Logger("extension");

// This method is called when your extension is activated based on the activation events
// defined in package.json
// ref: https://code.visualstudio.com/api/references/activation-events
export async function activate(
  context: vscode.ExtensionContext,
): Promise<vscode.ExtensionContext | undefined> {
  const extVersion = context.extension.packageJSON.version;
  observabilityContext.extensionVersion = extVersion;
  observabilityContext.extensionActivated = false;

  // determine the writeable tmpdir for the extension to use. Must be done prior
  // to starting the sidecar, as it will use this tmpdir for sidecar logfile.
  const result = await WriteableTmpDir.getInstance().determine();
  if (result.errors.length) {
    sentryCaptureException(new Error("No writeable tmpdir found."), {
      captureContext: {
        extra: {
          attemptedDirs: result.dirs.join("; "),
          errorsEncountered: result.errors.map((e) => e.message).join("; "),
        },
      },
    });
    // if we can't find a writeable tmpdir, we can't log anything, which is bad
    throw new Error("Can't activate extension: unable to find a writeable tmpdir");
  }

  logger.info(
    `Extension version ${context.extension.id} activate() triggered for version "${extVersion}".`,
  );
  logUsage(UserEvent.ExtensionActivation, { status: "started" });
  try {
    context = await _activateExtension(context);
    logger.info(`Extension version "${extVersion}" fully activated`);
    observabilityContext.extensionActivated = true;
    logUsage(UserEvent.ExtensionActivation, { status: "completed" });
  } catch (e) {
    logger.error(`Error activating extension version "${extVersion}":`, e);
    // if the extension is failing to activate for whatever reason, we need to know about it to fix it
    sentryCaptureException(e);
    logUsage(UserEvent.ExtensionActivation, { status: "failed" });
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
  // must be done first to allow any other downstream callers to call `getExtensionContext()`
  // (e.g. for globalState/workspaceState/secrets storage, webviews for extension root path, etc)
  setExtensionContext(context);

  // register the log output channels, debugging commands, and support commands to ensure we have
  // visibility into the extension and sidecar logs and can download support .zip and/or file issues
  context.subscriptions.push(
    OUTPUT_CHANNEL,
    SIDECAR_OUTPUT_CHANNEL,
    ...registerDebugCommands(),
    ...registerSupportCommands(),
  );
  // automatically display and focus the Confluent extension output channel in development mode
  // to avoid needing to keep the main window & Debug Console tab open alongside the extension dev
  // host window during debugging
  if (process.env.LOGGING_MODE === "development") {
    vscode.commands.executeCommand("confluent.showOutputChannel");
  }

  // set up initial feature flags and the LD client
  await setupFeatureFlags();

  // configure extension access to secrets and global/workspace states, and set the initial context
  // values for the VS Code UI to inform the `when` clauses in package.json
  await Promise.all([setupStorage(), setupContextValues()]);
  logger.info("Storage and context values initialized");

  // verify we can connect to the correct version of the sidecar, which may require automatically
  // killing any (old) sidecar process and starting a new one, going through the handshake, etc.
  logger.info("Starting/checking the sidecar...");
  await getSidecar();
  logger.info("Sidecar ready for use.");

  // set up the preferences listener to keep the sidecar in sync with the user/workspace settings
  const settingsListener: vscode.Disposable = await setupPreferences();
  context.subscriptions.push(settingsListener);

  // set up the different view providers
  const resourceViewProvider = ResourceViewProvider.getInstance();
  const topicViewProvider = TopicViewProvider.getInstance();
  const schemasViewProvider = SchemasViewProvider.getInstance();
  const statementsViewProvider = FlinkStatementsViewProvider.getInstance();
  const artifactsViewProvider = FlinkArtifactsViewProvider.getInstance();
  const supportViewProvider = new SupportViewProvider();
  const viewProviderDisposables: vscode.Disposable[] = [
    ...resourceViewProvider.disposables,
    ...topicViewProvider.disposables,
    ...schemasViewProvider.disposables,
    ...supportViewProvider.disposables,
    ...statementsViewProvider.disposables,
    ...artifactsViewProvider.disposables,
  ];
  logger.info("View providers initialized");
  // explicitly "reset" the Topics & Schemas views so no resources linger during reactivation/update
  topicViewProvider.reset();
  schemasViewProvider.reset();

  // Register refresh commands for our refreshable resource view providers.
  const refreshCommands: vscode.Disposable[] = [];
  for (const instance of getRefreshableViewProviders()) {
    refreshCommands.push(
      registerCommandWithLogging(`confluent.${instance.kind}.refresh`, (): boolean => {
        instance.refresh(true);
        return true;
      }),
    );
  }

  // Register the project scaffold listener
  const projectScaffoldListener = setProjectScaffoldListener();
  context.subscriptions.push(projectScaffoldListener);

  // register all the commands (apart from the view providers' refresh commands, which are handled above)
  const registeredCommands: vscode.Disposable[] = [
    ...refreshCommands,
    ...registerConnectionCommands(),
    ...registerOrganizationCommands(),
    ...registerKafkaClusterCommands(),
    ...registerEnvironmentCommands(),
    ...registerSchemaRegistryCommands(),
    ...registerSchemaCommands(),
    ...registerTopicCommands(),
    ...registerDiffCommands(),
    ...registerExtraCommands(),
    ...registerDockerCommands(),
    ...registerProjectGenerationCommands(),
    ...registerFlinkComputePoolCommands(),
    ...registerFlinkStatementCommands(),
    ...registerDocumentCommands(),
  ];
  logger.info("Commands registered");

  const uriHandler: vscode.Disposable = vscode.window.registerUriHandler(getUriHandler());
  const authProviderDisposables: vscode.Disposable[] = await setupAuthProvider();
  const documentProviders: vscode.Disposable[] = setupDocumentProviders();

  context.subscriptions.push(
    uriHandler,
    WebsocketManager.getInstance(),
    FlinkStatementManager.getInstance(),
    initializeFlinkLanguageClientManager(),
    ...authProviderDisposables,
    ...viewProviderDisposables,
    ...registeredCommands,
    ...documentProviders,
  );

  // these are also just handling command registration and setting disposables
  activateMessageViewer(context);
  activateFlinkStatementResultsViewer(context);

  // Construct the singletons, let them register their event listeners.
  context.subscriptions.push(...constructResourceLoaderSingletons());
  context.subscriptions.push(getSidecarManager());

  // register the local resource workflows so they can be used by the resource loaders
  registerLocalResourceWorkflows();
  // set up the local Docker event listener singleton and start watching for system events
  EventListener.getInstance().start();
  // reset the Docker credentials secret so `src/docker/configs.ts` can pull it fresh
  void context.secrets.delete(SecretStorageKeys.DOCKER_CREDS_SECRET_KEY);

  // Watch for sidecar pushing connection state changes over websocket.
  // (side effect of causing the watcher to be created)
  ConnectionStateWatcher.getInstance();

  const directConnectionManager = DirectConnectionManager.getInstance();
  context.subscriptions.push(...directConnectionManager.disposables);

  // ensure our diagnostic collection(s) are cleared when the extension is deactivated
  context.subscriptions.push(JSON_DIAGNOSTIC_COLLECTION);

  // register the search decoration provider for the tree views so any matches can be highlighted
  // with a dot to the right of the item label+description area
  context.subscriptions.push(
    vscode.window.registerFileDecorationProvider(SEARCH_DECORATION_PROVIDER),
  );

  // register the Copilot chat participant
  const chatParticipant = vscode.chat.createChatParticipant(PARTICIPANT_ID, chatHandler);
  const feedbackListener: vscode.Disposable = chatParticipant.onDidReceiveFeedback(handleFeedback);
  chatParticipant.iconPath = new vscode.ThemeIcon(IconNames.CONFLUENT_LOGO);
  context.subscriptions.push(chatParticipant, feedbackListener, ...registerChatTools());

  // track the status bar for CCloud notices (fetched from the Statuspage Status API)
  enableCCloudStatusPolling();
  context.subscriptions.push(getCCloudStatusBarItem());

  const docManager = DocumentMetadataManager.getInstance();
  context.subscriptions.push(...docManager.disposables);

  const provider = FlinkSqlCodelensProvider.getInstance();
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider("flinksql", provider),
    ...provider.disposables,
  );

  // one-time cleanup of old log files from before the rotating log file stream was implemented
  cleanupOldLogFiles();

  // XXX: used for testing; do not remove
  return context;
}

/** Configure any starting contextValues to use for view/menu controls during activation. */
async function setupContextValues() {
  // EXPERIMENTAL/PREVIEW: set default values for enabling the Flink view, resource fetching, and associated actions
  const config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration();
  const flinkEnabled = setContextValue(ContextValues.flinkEnabled, config.get(ENABLE_FLINK, false));
  const chatParticipantEnabled = setContextValue(
    ContextValues.chatParticipantEnabled,
    config.get(ENABLE_CHAT_PARTICIPANT, true),
  );
  // require re-selecting a cluster for the Topics/Schemas views on extension (re)start
  const kafkaClusterSelected = setContextValue(ContextValues.kafkaClusterSelected, false);
  const schemaRegistrySelected = setContextValue(ContextValues.schemaRegistrySelected, false);
  // constants for easier `when` clause matching in package.json; not updated dynamically
  const openInCCloudResources = setContextValue(ContextValues.CCLOUD_RESOURCES, [
    "ccloud-environment",
    "flinkable-ccloud-environment",
    "ccloud-kafka-cluster",
    "ccloud-kafka-topic",
    "ccloud-kafka-topic-with-schema",
    "ccloud-schema-registry",
    "ccloud-flink-compute-pool",
    "ccloud-flink-statement",
  ]);
  // allow for easier matching using "in" clauses for our Resources/Topics/Schemas views
  const viewsWithResources = setContextValue(ContextValues.VIEWS_WITH_RESOURCES, [
    "confluent-resources",
    "confluent-topics",
    "confluent-schemas",
    "confluent-flink-statements",
    "confluent-flink-artifacts",
  ]);

  // enables the "Copy ID" command; these resources must have the "id" property
  const resourcesWithIds = setContextValue(ContextValues.RESOURCES_WITH_ID, [
    "ccloud-environment", // direct/local environments only have internal IDs
    "flinkable-ccloud-environment",
    "ccloud-kafka-cluster",
    "ccloud-schema-registry", // only ID, no name
    "ccloud-flink-compute-pool",
    "ccloud-flink-artifact",
    "local-kafka-cluster",
    "local-schema-registry",
    "direct-kafka-cluster",
    "direct-schema-registry",
  ]);

  // enables the "Copy Name" command; these resources must have the "name" property
  const resourcesWithNames = setContextValue(ContextValues.RESOURCES_WITH_NAMES, [
    "ccloud-environment",
    "flinkable-ccloud-environment",
    "ccloud-kafka-cluster",
    "ccloud-flink-compute-pool",
    "ccloud-flink-statement",
    "ccloud-flink-artifact",
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
  const diffableResources = setContextValue(ContextValues.DIFFABLE_RESOURCES, [
    SCHEMA_URI_SCHEME,
    MESSAGE_URI_SCHEME,
  ]);
  await Promise.all([
    flinkEnabled,
    chatParticipantEnabled,
    kafkaClusterSelected,
    schemaRegistrySelected,
    openInCCloudResources,
    viewsWithResources,
    resourcesWithIds,
    resourcesWithNames,
    resourcesWithURIs,
    diffableResources,
  ]);
}

/**
 * Pass initial {@link vscode.WorkspaceConfiguration} settings to the sidecar's Preferences API on
 * startup to ensure the sidecar is in sync with the extension's settings before other requests are made.
 * @returns A {@link vscode.Disposable} for the extension settings listener
 */
async function setupPreferences(): Promise<vscode.Disposable> {
  // pass initial configs to the sidecar on startup
  await updatePreferences();
  logger.info("Initial preferences passed to sidecar");
  return createConfigChangeListener();
}

/**
 * Set up the feature flags for the extension. This includes setting the defaults, initializing the
 * LaunchDarkly client, and checking if the extension is enabled or disabled.
 */
async function setupFeatureFlags(): Promise<void> {
  // if the client initializes properly, it will set the initial flag values. otherwise, we'll use
  // the local defaults from `setFlagDefaults()`
  resetFlagDefaults();

  const client = await getLaunchDarklyClient();
  if (client) {
    // wait a few seconds for the LD client to initialize for the first time, because if we
    // continue to use the client before it's ready, it will return the default values for all flags
    const initialized = await Promise.race([
      client
        .waitForInitialization()
        .then(() => true)
        .catch((error) => {
          logger.error("Feature flag client failed to initialize:", error);
          return false;
        }),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3000)),
    ]);
    logger.info(`Feature flag client initialization ${initialized ? "completed" : "failed"}`);
  }

  const disabledMessage: string | undefined = await checkForExtensionDisabledReason();
  if (disabledMessage) {
    showExtensionDisabledNotification(disabledMessage);
    throw new Error(disabledMessage);
  }
}

/** Return view provider + name fragment pairs for auto-registering refresh() commands. */
export function getRefreshableViewProviders(): RefreshableTreeViewProvider[] {
  // When adding a new view provider pair, also update the test
  // mentioning "viewProviderNameFragments" in extension.test.ts.
  return [
    ResourceViewProvider.getInstance(),
    TopicViewProvider.getInstance(),
    SchemasViewProvider.getInstance(),
    FlinkStatementsViewProvider.getInstance(),
  ];
}

/**
 * Handle any necessary migrations for globalState/workspaceState/secrets that need to happen
 * before the extension can proceed.
 */
async function setupStorage(): Promise<void> {
  await migrateStorageIfNeeded();
  logger.info("Extension state/storage migrations completed");
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

  // Send an Identify event to Segment and LaunchDarkly with the session info if available
  if (cloudSession) {
    sendTelemetryIdentifyEvent({
      eventName: UserEvent.ExtensionActivation,
      userInfo: undefined,
      session: cloudSession,
    });
    (await getLaunchDarklyClient())?.identify({
      key: cloudSession.account.id,
      email: cloudSession.account.label,
    });
  }

  logger.info("Confluent Cloud auth provider registered");
  return [providerDisposable, ...provider.disposables];
}

/** Set up the document providers for custom URI schemes. */
function setupDocumentProviders(): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];
  // any document providers set here must provide their own `scheme` to register with
  const providerClasses = [
    SchemaDocumentProvider,
    MessageDocumentProvider,
    FlinkStatementDocumentProvider,
  ];
  for (const providerClass of providerClasses) {
    const provider = new providerClass();
    disposables.push(
      vscode.workspace.registerTextDocumentContentProvider(provider.scheme, provider),
    );
  }
  logger.info("Document providers registered");
  return disposables;
}

export function deactivate() {
  // dispose of the telemetry logger
  try {
    getTelemetryLogger().dispose();
  } catch (e) {
    const msg = "Error disposing telemetry logger during extension deactivation";
    logError(new Error(msg, { cause: e }), msg, { extra: {} });
  }
  closeSentryClient();

  disposeLaunchDarklyClient();
  disableCCloudStatusPolling();

  // close the file stream used with OUTPUT_CHANNEL -- needs to be done last to avoid any other
  // cleanup logging attempting to write to the file stream
  const logStream = getLogFileStream();
  if (logStream) {
    logStream.end();
  }
  console.info("Extension deactivated");
}
