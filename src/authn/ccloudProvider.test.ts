import { chromium } from "@playwright/test";
import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import {
  TEST_AUTHENTICATED_CCLOUD_CONNECTION,
  TEST_CCLOUD_CONNECTION,
  TEST_CCLOUD_USER,
} from "../../tests/unit/testResources/connection";
import { getTestExtensionContext, getTestStorageManager } from "../../tests/unit/testUtils";
import { Connection } from "../clients/sidecar";
import { CCLOUD_CONNECTION_ID } from "../constants";
import { getSidecar } from "../sidecar";
import * as connections from "../sidecar/connections";
import { getStorageManager, StorageManager } from "../storage";
import { SecretStorageKeys } from "../storage/constants";
import { getUriHandler, UriEventHandler } from "../uriHandler";
import { ConfluentCloudAuthProvider, getAuthProvider } from "./ccloudProvider";

const AUTH_CALLBACK_URI = vscode.Uri.parse("vscode://confluentinc.vscode-confluent/authCallback");

const TEST_CCLOUD_AUTH_SESSION: vscode.AuthenticationSession = {
  id: TEST_CCLOUD_CONNECTION.id!,
  accessToken: TEST_CCLOUD_CONNECTION.id!,
  account: {
    id: TEST_CCLOUD_USER.id!,
    label: TEST_CCLOUD_USER.username!,
  },
  scopes: [],
};

describe("ConfluentCloudAuthProvider", () => {
  let authProvider: ConfluentCloudAuthProvider;
  let uriHandler: UriEventHandler;

  let sandbox: sinon.SinonSandbox;
  // helper function stubs
  let getCCloudConnectionStub: sinon.SinonStub;
  let createCCloudConnectionStub: sinon.SinonStub;
  // auth provider stubs
  let browserAuthFlowStub: sinon.SinonStub;
  let stubOnDidChangeSessions: sinon.SinonStubbedInstance<
    vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>
  >;

  before(async () => {
    await getTestExtensionContext();

    uriHandler = getUriHandler();
  });

  beforeEach(() => {
    authProvider = getAuthProvider();

    sandbox = sinon.createSandbox();
    getCCloudConnectionStub = sandbox.stub(connections, "getCCloudConnection");
    createCCloudConnectionStub = sandbox.stub(connections, "createCCloudConnection");

    // assume the connection is immediately usable for most tests
    sandbox
      .stub(connections, "waitForConnectionToBeStable")
      .resolves(TEST_AUTHENTICATED_CCLOUD_CONNECTION);

    // don't handle the progress notification, openExternal, etc in this test suite
    browserAuthFlowStub = sandbox.stub(authProvider, "browserAuthFlow").resolves();
    stubOnDidChangeSessions = sandbox.createStubInstance(vscode.EventEmitter);
    authProvider["_onDidChangeSessions"] = stubOnDidChangeSessions;
  });

  afterEach(() => {
    // reset the singleton instance between tests
    ConfluentCloudAuthProvider["instance"] = null;
    sandbox.restore();
  });

  it("createSession() should create a new CCloud connection when one doesn't exist", async () => {
    // first call doesn't return a Connection, second call returns the connection from createCCloudConnection()
    getCCloudConnectionStub.onFirstCall().resolves(null);
    createCCloudConnectionStub.resolves(TEST_AUTHENTICATED_CCLOUD_CONNECTION);
    getCCloudConnectionStub.onSecondCall().resolves(TEST_AUTHENTICATED_CCLOUD_CONNECTION);

    await authProvider.createSession();

    assert.ok(createCCloudConnectionStub.called);
    assert.ok(browserAuthFlowStub.called);
  });

  it("createSession() should reuse an existing CCloud connection", async () => {
    getCCloudConnectionStub.resolves(TEST_AUTHENTICATED_CCLOUD_CONNECTION);

    await authProvider.createSession();

    assert.ok(createCCloudConnectionStub.notCalled);
    assert.ok(browserAuthFlowStub.called);
  });

  it("createSession() should update the auth status secret on successful authentication", async () => {
    const setSecretStub = sandbox.stub(getStorageManager(), "setSecret").resolves();
    getCCloudConnectionStub.resolves(TEST_AUTHENTICATED_CCLOUD_CONNECTION);

    await authProvider.createSession();

    assert.ok(
      setSecretStub.calledWith(
        SecretStorageKeys.CCLOUD_AUTH_STATUS,
        TEST_AUTHENTICATED_CCLOUD_CONNECTION.status.authentication.status,
      ),
    );
  });

  it("getSessions() should treat connections with a NO_TOKEN/FAILED auth status as nonexistent", async () => {
    getCCloudConnectionStub.resolves(TEST_CCLOUD_CONNECTION);

    const sessions = await authProvider.getSessions();

    assert.deepStrictEqual(sessions, []);
  });

  it("getSessions() should return an empty array when no connection exists", async () => {
    getCCloudConnectionStub.resolves(null);

    const sessions = await authProvider.getSessions();

    assert.deepStrictEqual(sessions, []);
  });

  it("getSessions() should return an AuthenticationSession when a valid connection exists", async () => {
    getCCloudConnectionStub.resolves(TEST_AUTHENTICATED_CCLOUD_CONNECTION);

    const sessions = await authProvider.getSessions();

    assert.strictEqual(sessions.length, 1);
    assert.deepStrictEqual(sessions[0], TEST_CCLOUD_AUTH_SESSION);
  });

  it("removeSession() should delete an existing connection and the auth status secret", async () => {
    const handleSessionRemovedStub = sandbox.stub().resolves();
    authProvider["handleSessionRemoved"] = handleSessionRemovedStub;
    getCCloudConnectionStub.resolves(TEST_AUTHENTICATED_CCLOUD_CONNECTION);
    const deleteConnectionStub = sandbox.stub(connections, "deleteCCloudConnection").resolves();
    const deleteSecretStub = sandbox.stub(getStorageManager(), "deleteSecret").resolves();

    await authProvider.removeSession("sessionId");

    assert.ok(deleteConnectionStub.called);
    assert.ok(deleteSecretStub.calledWith(SecretStorageKeys.CCLOUD_AUTH_STATUS));
    assert.ok(handleSessionRemovedStub.calledWith(true));
  });

  it("removeSession() should only update the provider's internal state when no connection exists", async () => {
    const handleSessionRemovedStub = sandbox.stub().resolves();
    authProvider["handleSessionRemoved"] = handleSessionRemovedStub;
    getCCloudConnectionStub.resolves(null);
    const deleteConnectionStub = sandbox.stub(connections, "deleteCCloudConnection").resolves();

    authProvider["_session"] = null;
    await authProvider.removeSession("sessionId");

    assert.ok(deleteConnectionStub.notCalled);
    assert.ok(handleSessionRemovedStub.notCalled);
  });

  it("removeSession() should only update the provider's internal state when no connection exists but the provider is still tracking a session internally", async () => {
    const handleSessionRemovedStub = sandbox.stub().resolves();
    authProvider["handleSessionRemoved"] = handleSessionRemovedStub;
    getCCloudConnectionStub.resolves(null);
    const deleteConnectionStub = sandbox.stub(connections, "deleteCCloudConnection").resolves();

    authProvider["_session"] = TEST_CCLOUD_AUTH_SESSION;
    await authProvider.removeSession("sessionId");

    assert.ok(deleteConnectionStub.notCalled);
    assert.ok(handleSessionRemovedStub.calledWith(true));
  });

  it("handleSessionCreated() should update the provider's internal state, fire the _onDidChangeSessions event.", async () => {
    const storageManager = getStorageManager();
    const setSecretStub = sandbox.stub(storageManager, "setSecret").resolves();

    await authProvider["handleSessionCreated"](TEST_CCLOUD_AUTH_SESSION, true);

    assert.strictEqual(authProvider["_session"], TEST_CCLOUD_AUTH_SESSION);
    assert.ok(setSecretStub.calledWith(SecretStorageKeys.AUTH_SESSION_EXISTS, "true"));
    assert.ok(stubOnDidChangeSessions.fire.called);
    assert.ok(
      stubOnDidChangeSessions.fire.calledWith({
        added: [TEST_CCLOUD_AUTH_SESSION],
        removed: [],
        changed: [],
      }),
    );
  });

  it("handleSessionRemoved() should update the provider's internal state, fire the _onDidChangeSessions event.", async () => {
    const storageManager = getStorageManager();
    const deleteSecretStub = sandbox.stub(storageManager, "deleteSecret").resolves();

    authProvider["_session"] = TEST_CCLOUD_AUTH_SESSION;
    await authProvider["handleSessionRemoved"](true);

    assert.strictEqual(authProvider["_session"], null);
    assert.ok(deleteSecretStub.calledWith(SecretStorageKeys.AUTH_SESSION_EXISTS));
    assert.ok(deleteSecretStub.calledWith(SecretStorageKeys.AUTH_COMPLETED));
    assert.ok(stubOnDidChangeSessions.fire.called);
    assert.ok(
      stubOnDidChangeSessions.fire.calledWith({
        added: [],
        removed: [TEST_CCLOUD_AUTH_SESSION],
        changed: [],
      }),
    );
  });

  it("handleSessionSecretChange() should call handleSessionCreated() when a session is available", async () => {
    const handleSessionCreatedStub = sandbox.stub().resolves();
    authProvider["handleSessionCreated"] = handleSessionCreatedStub;
    const handleSessionRemovedStub = sandbox.stub().resolves();
    authProvider["handleSessionRemoved"] = handleSessionRemovedStub;
    sandbox.stub(vscode.authentication, "getSession").resolves(TEST_CCLOUD_AUTH_SESSION);

    await authProvider["handleSessionSecretChange"]();

    assert.ok(handleSessionCreatedStub.calledOnceWith(TEST_CCLOUD_AUTH_SESSION));
    assert.ok(handleSessionRemovedStub.notCalled);
  });

  it("handleSessionSecretChange() should call handleSessionRemoved() when no session is available", async () => {
    const handleSessionCreatedStub = sandbox.stub().resolves();
    authProvider["handleSessionCreated"] = handleSessionCreatedStub;
    const handleSessionRemovedStub = sandbox.stub().resolves();
    authProvider["handleSessionRemoved"] = handleSessionRemovedStub;

    sandbox.stub(vscode.authentication, "getSession").resolves(undefined);

    authProvider["_session"] = TEST_CCLOUD_AUTH_SESSION;
    await authProvider["handleSessionSecretChange"]();

    assert.ok(handleSessionCreatedStub.notCalled);
    assert.ok(handleSessionRemovedStub.called);
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
    await connections.deleteCCloudConnection();
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
    const newConnection: Connection = await connections.createCCloudConnection();
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
