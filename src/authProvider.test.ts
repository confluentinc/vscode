import { chromium } from "@playwright/test";
import * as assert from "assert";
import * as vscode from "vscode";
import { getExtensionContext, getTestStorageManager } from "../tests/unit/testUtils";
import { ConfluentCloudAuthProvider, getAuthProvider } from "./authProvider";
import { Connection } from "./clients/sidecar";
import { CCLOUD_CONNECTION_ID } from "./constants";
import { getSidecar } from "./sidecar";
import { createCCloudConnection, deleteCCloudConnection } from "./sidecar/connections";
import { StorageManager } from "./storage";
import { getUriHandler, UriEventHandler } from "./uriHandler";

const AUTH_CALLBACK_URI = vscode.Uri.parse("vscode://confluentinc.vscode-confluent/authCallback");

describe("ConfluentCloudAuthProvider", () => {
  let authProvider: ConfluentCloudAuthProvider;
  let uriHandler: UriEventHandler;

  before(async () => {
    await getExtensionContext();
    authProvider = getAuthProvider();
    uriHandler = getUriHandler();
  });

  it("should reject the waitForUriHandling promise when the URI query contains 'success=false'", async () => {
    const promise = authProvider.waitForUriHandling();

    const uri = AUTH_CALLBACK_URI.with({ query: "success=false" });
    uriHandler.handleUri(uri);

    await promise.catch((err) => {
      assert.equal(err.message, "Authentication failed, see browser for details");
    });
  });

  it("should resolve the waitForUriHandling promise when the URI query contains 'success=true'", async () => {
    const promise = authProvider.waitForUriHandling();

    const uri = AUTH_CALLBACK_URI.with({ query: "success=true" });
    uriHandler.handleUri(uri);

    await promise.then((result) => {
      assert.equal(result, undefined);
    });
  });
});

describe("CCloud auth flow", () => {
  let storageManager: StorageManager;

  before(async () => {
    storageManager = await getTestStorageManager();
  });

  beforeEach(async () => {
    await storageManager.clearWorkspaceState();
    // make sure we don't have a lingering CCloud connection from other tests
    await deleteCCloudConnection();
  });

  it("should successfully authenticate via CCloud with the sign_in_uri", async function () {
    if (!process.env.E2E_USERNAME || !process.env.E2E_PASSWORD) {
      // These env vars needed within testAuthFlow() for any of this to work.
      console.log("Skipping test: E2E_USERNAME and/or E2E_PASSWORD not set in .env file");
      this.skip();
    }

    // NOTE: can't be used with an arrow-function because it needs to be able to access `this`
    this.slow(10000); // mark this test as slow if it takes longer than 10s
    this.retries(2); // retry this test up to 2 times if it fails
    const newConnection: Connection = await createCCloudConnection();
    await testAuthFlow(newConnection.metadata.sign_in_uri!);
    // make sure the newly-created connection is available via the sidecar
    const client = (await getSidecar()).getConnectionsResourceApi();
    const connection = await client.gatewayV1ConnectionsIdGet({ id: CCLOUD_CONNECTION_ID });
    assert.ok(
      connection,
      "No connections found; make sure to manually log in with the test username/password, because the 'Authorize App: Confluent VS Code Extension is requesting access to your Confluent account' (https://login.confluent.io/u/consent?...) page may be blocking the auth flow for this test. If that doesn't work, try running the test with `{ headless: false }` (in testAuthFlow()) to see what's happening.",
    );
    assert.ok(connection);
    assert.notEqual(connection.status.authentication.status, "NO_TOKEN");
    assert.equal(connection.status.authentication.user?.username, process.env.E2E_USERNAME);
  });
});

async function testAuthFlow(signInUri: string) {
  const browser = await chromium.launch(); // set { headless: false } here for local debugging
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(signInUri);

  await page.locator("[name=email]").fill(process.env.E2E_USERNAME!);
  await page.locator("[type=submit]").click();
  await page.locator("[name=password]").fill(process.env.E2E_PASSWORD!);
  await page.locator("[type=submit]").click();
  await page.waitForURL(/127\.0\.0\.1/, { waitUntil: "networkidle" });
  await page.close();
}
