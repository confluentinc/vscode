import {
  _electron as electron,
  ElectronApplication,
  expect,
  Page,
  test as testBase,
} from "@playwright/test";
import { stubAllDialogs } from "electron-playwright-helpers";
import { existsSync, mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import {
  ConnectionType,
  DirectConnectionOptions,
  FormConnectionType,
  LocalConnectionOptions,
  SupportedAuthType,
} from "./connectionTypes";
import { Notification } from "./objects/notifications/Notification";
import { NotificationArea } from "./objects/notifications/NotificationArea";
import { CCloudConnectionItem } from "./objects/views/viewItems/CCloudConnectionItem";
import { DirectConnectionItem } from "./objects/views/viewItems/DirectConnectionItem";
import { LocalConnectionItem } from "./objects/views/viewItems/LocalConnectionItem";
import {
  cleanupLocalConnection,
  setupCCloudConnection,
  setupDirectConnection,
  setupLocalConnection,
} from "./utils/connections";
import { configureVSCodeSettings } from "./utils/settings";
import { openConfluentSidebar } from "./utils/sidebarNavigation";

// NOTE: we can't import these two directly from 'global.setup.ts'
// cached test setup file path that's shared across worker processes
const TEST_SETUP_CACHE_FILE = path.join(tmpdir(), "vscode-e2e-test-setup-cache.json");

interface TestSetupCache {
  vscodeExecutablePath: string;
  outPath: string;
}

/** Get the test setup cache created by the global setup, avoiding repeated VS Code setup logging. */
function getTestSetupCache(): TestSetupCache {
  if (!existsSync(TEST_SETUP_CACHE_FILE)) {
    throw new Error(`Test setup cache file not found at ${TEST_SETUP_CACHE_FILE}.`);
  }
  try {
    const cacheContent = readFileSync(TEST_SETUP_CACHE_FILE, "utf-8");
    return JSON.parse(cacheContent);
  } catch (error) {
    throw new Error(`Failed to read test setup cache: ${error}`);
  }
}

interface VSCodeFixtures {
  /** The launched Electron application (VS Code). */
  electronApp: ElectronApplication;
  /** The first window of the launched Electron application (VS Code). */
  page: Page;

  /** Open the Confluent view container from the primary sidebar, activating the extension if necessary. */
  openExtensionSidebar: void;

  /**
   * Connection type to set up for parameterized tests.
   * Used by the setupConnection fixture to determine which connection to create.
   */
  connectionType: ConnectionType;
  /**
   * Configuration options for setting up a direct connection with the {@linkcode directConnection} fixture.
   */
  directConnectionConfig: DirectConnectionOptions;
  /**
   * Configuration options for setting up a local connection with the {@linkcode localConnection} fixture.
   * If not provided, the local connection will set up both Kafka and Schema Registry by default.
   */
  localConnectionConfig: LocalConnectionOptions;
  /**
   * Set up a connection based on the {@linkcode connectionType} option and returns the associated
   * connection item ({@link CCloudConnectionItem}, {@link DirectConnectionItem}, or {@link LocalConnectionItem}).
   */
  setupConnection: CCloudConnectionItem | DirectConnectionItem | LocalConnectionItem;
}

export const test = testBase.extend<VSCodeFixtures>({
  electronApp: async ({ trace }, use, testInfo) => {
    const testConfigs = getTestSetupCache();

    // create a temporary directory for this test run
    const tempDir = mkdtempSync(path.join(tmpdir(), "vscode-test-"));

    // launch VS Code with Electron using args pattern from vscode-test
    const electronApp = await electron.launch({
      executablePath: testConfigs.vscodeExecutablePath,
      args: [
        // same as the Mocha test args in Gulpfile.js:
        "--no-sandbox",
        "--skip-release-notes",
        "--skip-welcome",
        "--disable-gpu",
        "--disable-updates",
        "--disable-workspace-trust",
        "--disable-extensions",
        // required to prevent test resources being saved to user's real profile
        `--user-data-dir=${tempDir}`,
        // additional args needed for the Electron launch:
        `--extensionDevelopmentPath=${testConfigs.outPath}`,
      ],
    });

    if (!electronApp) {
      throw new Error("Failed to launch VS Code electron app");
    }

    // wait for VS Code to be ready before trying to stub dialogs
    const page = await electronApp.firstWindow();
    if (!page) {
      // usually this means the launch args were incorrect and/or the app didn't start correctly
      throw new Error("Failed to get first window from VS Code");
    }
    await page.waitForLoadState("domcontentloaded");
    await page.locator(".monaco-workbench").waitFor({ timeout: 30000 });

    // Stub all dialogs by default; tests can still override as needed.
    // For available `method` values to use with `stubMultipleDialogs`, see:
    // https://www.electronjs.org/docs/latest/api/dialog
    await stubAllDialogs(electronApp);

    // on*, retain-on*
    if (trace.toString().includes("on")) {
      await electronApp.context().tracing.start({
        screenshots: true,
        snapshots: true,
        sources: true,
        title: testInfo.title,
      });
    }

    await use(electronApp);

    try {
      // shorten grace period for shutdown to avoid hanging the entire test run
      await Promise.race([
        electronApp.close(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("electronApp.close() timeout after 10s")), 10000),
        ),
      ]);
    } catch (error) {
      console.warn("Error closing electron app:", error);
      // force-kill if needed
      try {
        await electronApp.context().close();
      } catch (contextError) {
        console.warn("Error closing electron context:", contextError);
      }
    }
  },

  page: async ({ electronApp }, use) => {
    if (!electronApp) {
      throw new Error("electronApp is null - failed to launch VS Code");
    }

    const page = await electronApp.firstWindow();
    if (!page) {
      // shouldn't happen since we waited for the workbench above
      throw new Error("Failed to get first window from VS Code");
    }

    await globalBeforeEach(page, electronApp);

    await use(page);
  },

  openExtensionSidebar: [
    async ({ page }, use) => {
      await openConfluentSidebar(page);

      await use();

      // no explicit teardown needed
    },
    { auto: true }, // automatically run for all tests unless opted out
  ],

  directConnectionConfig: [
    {
      formConnectionType: FormConnectionType.ConfluentCloud,
      kafkaConfig: {
        bootstrapServers: process.env.E2E_KAFKA_BOOTSTRAP_SERVERS!,
        authType: SupportedAuthType.API,
        credentials: {
          api_key: process.env.E2E_KAFKA_API_KEY!,
          api_secret: process.env.E2E_KAFKA_API_SECRET!,
        },
      },
      schemaRegistryConfig: {
        uri: process.env.E2E_SR_URL!,
        authType: SupportedAuthType.API,
        credentials: {
          api_key: process.env.E2E_SR_API_KEY!,
          api_secret: process.env.E2E_SR_API_SECRET!,
        },
      },
    },
    { option: true },
  ],

  localConnectionConfig: [
    {
      kafka: true,
      schemaRegistry: true,
    },
    { option: true },
  ],

  // no default value, must be provided by test
  connectionType: undefined as any,

  setupConnection: async (
    {
      electronApp,
      page,
      openExtensionSidebar,
      connectionType,
      directConnectionConfig,
      localConnectionConfig,
    },
    use,
  ) => {
    if (!connectionType) {
      throw new Error(
        "connectionType must be set, like `test.use({ connectionType: ConnectionType.Ccloud })`",
      );
    }

    let connection: CCloudConnectionItem | DirectConnectionItem | LocalConnectionItem;

    // setup
    switch (connectionType) {
      case ConnectionType.Ccloud:
        connection = await setupCCloudConnection(
          page,
          electronApp,
          process.env.E2E_USERNAME!,
          process.env.E2E_PASSWORD!,
        );
        break;
      case ConnectionType.Direct:
        connection = await setupDirectConnection(page, directConnectionConfig);
        break;
      case ConnectionType.Local:
        connection = await setupLocalConnection(page, localConnectionConfig);
        break;
      default:
        throw new Error(`Unsupported connection type: ${connectionType}`);
    }

    await use(connection);

    // teardown
    switch (connectionType) {
      case ConnectionType.Ccloud:
        // no explicit teardown needed since shutting down the extension+sidecar will invalidate the
        // CCloud auth session
        break;
      case ConnectionType.Direct:
        // no teardown needed since each test will use its own storage in TMPDIR, so any direct
        // connections created will be cleaned up automatically, and subsequent tests will use their
        // own blank-slate storage
        break;
      case ConnectionType.Local:
        // local resources are discovered automatically through the Docker engine API, so we need
        // to explicitly stop them to ensure the next tests can start them fresh
        await cleanupLocalConnection(connection.page, {
          schemaRegistry: localConnectionConfig.schemaRegistry,
        });
        break;
      default:
        throw new Error(`Unsupported connection type: ${connectionType}`);
    }
  },
});

/**
 * Global setup that runs before each test.
 *
 * NOTE: Due to our Electron launch setup, this is more reliable than using
 * {@linkcode https://playwright.dev/docs/api/class-test#test-before-each test.beforeEach()}, which
 * did not consistently run before each test.
 */
async function globalBeforeEach(page: Page, electronApp: ElectronApplication): Promise<void> {
  // make sure settings are set to defaults for each test
  await configureVSCodeSettings(page, electronApp);

  // dismiss the "All installed extensions are temporarily disabled" notification that will
  // always appear since we launch with --disable-extensions
  const notificationArea = new NotificationArea(page);
  const infoNotifications = notificationArea.infoNotifications.filter({
    hasText: "All installed extensions are temporarily disabled",
  });
  await expect(infoNotifications).not.toHaveCount(0);
  const notification = new Notification(page, infoNotifications.first());
  await notification.dismiss();
}
