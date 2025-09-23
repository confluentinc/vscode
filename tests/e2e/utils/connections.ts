import { ElectronApplication, expect, Locator, Page } from "@playwright/test";
import { Notification } from "../objects/notifications/Notification";
import { NotificationArea } from "../objects/notifications/NotificationArea";
import { ResourcesView } from "../objects/views/ResourcesView";
import { DirectConnectionForm } from "../objects/webviews/DirectConnectionFormWebview";

import { chromium } from "@playwright/test";
import { stubMultipleDialogs } from "electron-playwright-helpers";
import { readFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { DirectConnectionOptions, LocalConnectionOptions } from "../connectionTypes";
import { URI_SCHEME } from "../constants";
import { InputBox } from "../objects/quickInputs/InputBox";
import { Quickpick } from "../objects/quickInputs/Quickpick";
import { CCloudConnectionItem } from "../objects/views/viewItems/CCloudConnectionItem";
import { DirectConnectionItem } from "../objects/views/viewItems/DirectConnectionItem";
import { LocalConnectionItem } from "../objects/views/viewItems/LocalConnectionItem";
import { executeVSCodeCommand } from "./commands";
import { openConfluentSidebar } from "./sidebarNavigation";

export const CCLOUD_SIGNIN_URL_PATH = join(tmpdir(), "vscode-e2e-ccloud-signin-url.txt");
export const NOT_CONNECTED_TEXT = "(No connection)";

/**
 * Creates a CCloud connection by logging in to Confluent Cloud from the sidebar auth flow,
 * completing the OAuth flow in a browser, and handling the callback in the extension.
 *
 * @param page The Playwright {@link Page} instance
 * @param electronApp The Electron {@link ElectronApplication app} instance
 * @param username The username to authenticate with
 * @param password The password to authenticate with
 */
export async function setupCCloudConnection(
  page: Page,
  electronApp: ElectronApplication,
  username: string,
  password: string,
): Promise<CCloudConnectionItem> {
  // reset the CCloud sign-in file before the sign-in flow even starts so we don't use a stale URL
  try {
    await unlink(CCLOUD_SIGNIN_URL_PATH);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("Error deleting CCloud sign-in URL file:", error);
    }
  }

  const confirmButtonIndex = process.platform === "linux" ? 1 : 0;
  await stubMultipleDialogs(electronApp, [
    // Handles both auth dialogs:
    // 1. "Allow signing in with Confluent Cloud"
    // 2. "Permission to open the URL"
    {
      method: "showMessageBox",
      value: {
        response: confirmButtonIndex, // Simulates clicking "Allow"/"Open"
        checkboxChecked: false,
      },
    },
  ]);

  const resourcesView = new ResourcesView(page);
  const ccloudItem = new CCloudConnectionItem(page, resourcesView.confluentCloudItem);
  await expect(ccloudItem.locator).toContainText(NOT_CONNECTED_TEXT);
  await ccloudItem.clickSignIn();

  // the auth provider will write to this once it gets the CCloud sign-in URL from the sidecar
  let authUrl: string | null = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      authUrl = await readFile(CCLOUD_SIGNIN_URL_PATH, "utf-8");
      if (authUrl.trim()) {
        break;
      }
    } catch {
      // file doesn't exist yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!authUrl) {
    throw new Error(`Failed to load CCloud sign-in URL from ${CCLOUD_SIGNIN_URL_PATH}`);
  }

  // Handle the authentication flow through the browser in a separate context
  const browser = await chromium.launch(); // headless by default
  const context = await browser.newContext();
  const authPage = await context.newPage();
  try {
    // Navigate to the auth URL and wait for the page to be fully loaded
    await authPage.goto(authUrl, { waitUntil: "domcontentloaded" });
    // Additional wait to ensure page is interactive
    await authPage.waitForLoadState("domcontentloaded");
    // Wait for email input to be visible and ready
    await expect(authPage.locator("[name=email]")).toBeVisible();
    // Fill in credentials
    await authPage.locator("[name=email]").fill(username);
    await authPage.locator("[type=submit]").click();
    await authPage.locator("[name=password]").fill(password);
    await authPage.locator("[type=submit]").click();
    await expect(authPage.locator("text=Authentication Complete")).toBeVisible();
  } finally {
    // Ensure browser resources are closed even if there's an error
    await authPage.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  // Unfortunately, the auth callback URI handling does not reliably work on all environments
  // we run these tests, so we have to work around it:
  // - when the E2E tests start via `gulp e2e`, we set the CONFLUENT_VSCODE_E2E_TESTING environment
  //  variable, which sets the CCLOUD_AUTH_CALLBACK_URI to an empty string, preventing the sidecar
  //  from using it (see https://github.com/confluentinc/ide-sidecar/blob/f302286ff0f7234581b07cef4ec978e33030617f/src/main/resources/templates/callback.html#L13-L16)
  // - since the URI is not automatically handled, we have to manually trigger the command
  //  that handles it and then provide the callback URI via an input box
  // NOTE: This is safe because handleAuthFlow() didn't throw any errors by this point, which means
  // we saw an "Authentication Complete" message in the browser, so the sidecar should have done its
  // own callback handling to update the CCloud connection to a fully authenticated state.
  await executeVSCodeCommand(page, "confluent.handleUri");
  const uriInputBox = new InputBox(page);
  await expect(uriInputBox.locator).toBeVisible();
  await uriInputBox.input.fill(
    `${URI_SCHEME}://confluentinc.vscode-confluent/authCallback?success=true`,
  );
  await uriInputBox.confirm();

  // Make sure the "Confluent Cloud" item in the Resources view is expanded and doesn't show the
  // "(No connection)" description
  await expect(ccloudItem.locator).toBeVisible();
  await expect(ccloudItem.locator).not.toContainText(NOT_CONNECTED_TEXT);
  await expect(ccloudItem.locator).toHaveAttribute("aria-expanded", "true");
  return ccloudItem;
}

/** Creates a direct connection and expands it in the Resources view. */
export async function setupDirectConnection(
  page: Page,
  options: DirectConnectionOptions,
  expectError = false,
): Promise<DirectConnectionItem> {
  const resourcesView = new ResourcesView(page);

  const connectionForm: DirectConnectionForm = await resourcesView.addNewConnectionManually();

  const connectionName = options.name ?? "Playwright";
  await connectionForm.fillConnectionName(connectionName);

  if (options.formConnectionType) {
    await connectionForm.selectConnectionType(options.formConnectionType);
  }

  const { kafkaConfig, schemaRegistryConfig } = options;
  if (!(kafkaConfig || schemaRegistryConfig)) {
    throw new Error("No configs set - `kafkaConfig` or `schemaRegistryConfig` must be provided");
  }
  if (kafkaConfig) {
    await connectionForm.fillKafkaBootstrapServers(kafkaConfig.bootstrapServers);
    await connectionForm.selectKafkaAuthType(kafkaConfig.authType);
    await connectionForm.fillKafkaCredentials(kafkaConfig.credentials);
  }
  if (schemaRegistryConfig) {
    await connectionForm.fillSchemaRegistryUri(schemaRegistryConfig.uri);
    await connectionForm.selectSchemaRegistryAuthType(schemaRegistryConfig.authType);
    await connectionForm.fillSchemaRegistryCredentials(schemaRegistryConfig.credentials);
  }

  await connectionForm.testButton.click();
  const status = expectError ? connectionForm.errorMessage : connectionForm.successMessage;
  await expect(status).not.toHaveCount(0);
  await connectionForm.saveButton.click();

  // make sure we see the notification indicating the connection was created
  const notificationArea = new NotificationArea(page);
  const notifications: Locator = notificationArea.infoNotifications.filter({
    hasText: "New Connection Created",
  });
  await expect(notifications).toHaveCount(1);
  const notification = new Notification(page, notifications.first());
  await notification.dismiss();
  // don't wait for the "Waiting for <connection> to be usable..." progress notification since
  // it may disappear quickly

  // wait for the Resources view to refresh and show the new direct connection
  await expect(resourcesView.directConnections).not.toHaveCount(0);
  const connectionItem = new DirectConnectionItem(
    page,
    resourcesView.directConnections.filter({ hasText: connectionName }).first(),
  );
  await expect(connectionItem.label).toHaveText(connectionName);

  if (expectError) {
    // invalid configurations won't be expandable at all
    await expect(connectionItem.locator).not.toHaveAttribute("aria-expanded");
  } else {
    // direct connections are collapsed by default in the old Resources view, but expanded in the
    // new Resources view
    if ((await connectionItem.locator.getAttribute("aria-expanded")) === "false") {
      await connectionItem.locator.click();
    }
    await expect(connectionItem.locator).toHaveAttribute("aria-expanded", "true");
  }

  return connectionItem;
}

/** Starts local resources (Kafka, Schema Registry) through the Resources view. */
export async function setupLocalConnection(
  page: Page,
  options: LocalConnectionOptions,
): Promise<LocalConnectionItem> {
  const resourcesView = new ResourcesView(page);
  const localItem = new LocalConnectionItem(page, resourcesView.localItem);
  await expect(localItem.locator).toBeVisible();

  // TEMPORARY: until we can isolate test containers from real containers, we'll have to enforce
  // no currently running containers and fail sooner rather than waiting for the default timeout
  await expect(
    localItem.locator,
    "Local resources must be stopped before running @local tests.",
  ).not.toHaveAttribute("aria-expanded", { timeout: 1000 });

  await localItem.clickStartResources();
  // multi-select quickpick to select which resources to start
  const containerQuickpick = new Quickpick(page);
  await expect(containerQuickpick.locator).toBeVisible();
  // local Kafka is always started by default and has to be started if SR is selected
  if (options.schemaRegistry) {
    await containerQuickpick.selectItemByText("Schema Registry");
  }
  await containerQuickpick.confirm();

  // if we're creating containers instead of just starting them, we'll need to provide a number of
  // Kafka broker containers to start
  const notificationArea = new NotificationArea(page);
  const progressNotifications: Locator = notificationArea.progressNotifications.filter({
    hasText: "Preparing for broker container creation",
  });
  try {
    await expect(progressNotifications).toHaveCount(1, { timeout: 5000 });
    // wait up to 5s for the broker input to appear, then accept the default if present
    const brokerInput = new InputBox(page);
    await brokerInput.confirm(); // accept the default of 1 broker/container
  } catch {
    // broker input did not appear within 5s — continue without confirming
  }

  await expect(localItem.locator).toHaveAttribute("aria-expanded", "true");
  // local SR requires local Kafka, so we should always see local Kafka appear
  await expect(resourcesView.localKafkaClusters).not.toHaveCount(0);
  if (options.schemaRegistry) {
    // if we pull the SR image, this could take a while
    await expect(resourcesView.localSchemaRegistries).not.toHaveCount(0, { timeout: 60_000 });
  }
  return localItem;
}

/** Stops local resources (Kafka and optionally Schema Registry) through the Resources view. */
export async function teardownLocalConnection(page: Page, options: LocalConnectionOptions) {
  // always make sure the sidebar is open and we're in the Resources view before we try to interact
  // with the local connection item
  await openConfluentSidebar(page);

  const resourcesView = new ResourcesView(page);
  const localItem = new LocalConnectionItem(page, resourcesView.localItem.first());
  await expect(localItem.locator).toHaveAttribute("aria-expanded", "true");
  await localItem.clickStopResources();

  if (options.schemaRegistry) {
    // we only see the quickpick if both local Kafka and SR are running
    const containerQuickpick = new Quickpick(page);
    await containerQuickpick.selectItemByText("Schema Registry");
    await containerQuickpick.selectItemByText("Kafka");
    await containerQuickpick.confirm();
  }

  // once the resources are stopped, the local connection shouldn't be expandable
  await expect(resourcesView.localItem).not.toHaveAttribute("aria-expanded");
}
