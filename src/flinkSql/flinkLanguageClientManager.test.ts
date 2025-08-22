import * as assert from "assert";
import sinon from "sinon";
import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/node";
import { AddressInfo, WebSocketServer } from "ws";
import {
  eventEmitterStubs,
  StubbedEventEmitters,
  vscodeEventRegistrationStubs,
  VscodeEventRegistrationStubs,
} from "../../tests/stubs/emitters";
import { getStubbedSecretStorage, StubbedSecretStorage } from "../../tests/stubs/extensionStorage";
import { getStubbedCCloudResourceLoader } from "../../tests/stubs/resourceLoaders";
import { StubbedWorkspaceConfiguration } from "../../tests/stubs/workspaceConfiguration";
import { TEST_CCLOUD_ENVIRONMENT, TEST_CCLOUD_KAFKA_CLUSTER } from "../../tests/unit/testResources";
import {
  TEST_CCLOUD_FLINK_COMPUTE_POOL,
  TEST_CCLOUD_FLINK_COMPUTE_POOL_ID,
} from "../../tests/unit/testResources/flinkComputePool";
import { TEST_CCLOUD_ORGANIZATION } from "../../tests/unit/testResources/organization";
import * as flinkSqlProvider from "../codelens/flinkSqlProvider";
import { FLINKSTATEMENT_URI_SCHEME } from "../documentProviders/flinkStatement";
import { FLINK_CONFIG_COMPUTE_POOL, FLINK_CONFIG_DATABASE } from "../extensionSettings/constants";
import { CCloudResourceLoader } from "../loaders";
import { CCloudEnvironment } from "../models/environment";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { CCloudKafkaCluster } from "../models/kafkaCluster";
import * as ccloud from "../sidecar/connections/ccloud";
import { SecretStorageKeys, UriMetadataKeys } from "../storage/constants";
import { ResourceManager } from "../storage/resourceManager";
import { FlinkLanguageClientManager, FLINKSQL_LANGUAGE_ID } from "./flinkLanguageClientManager";
import * as languageClient from "./languageClient";

describe("FlinkLanguageClientManager", () => {
  let sandbox: sinon.SinonSandbox;
  let stubbedConfigs: StubbedWorkspaceConfiguration;
  let hasCCloudAuthSessionStub: sinon.SinonStub;
  let flinkManager: FlinkLanguageClientManager;
  let ccloudLoaderStub: sinon.SinonStubbedInstance<CCloudResourceLoader>;
  let getCatalogDatabaseFromMetadataStub: sinon.SinonStub;
  let resourceManagerStub: sinon.SinonStubbedInstance<ResourceManager>;

  const TEST_FILE_URI = vscode.Uri.parse("file:///test.flink.sql");

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    FlinkLanguageClientManager["instance"] = null;
    stubbedConfigs = new StubbedWorkspaceConfiguration(sandbox);
    hasCCloudAuthSessionStub = sandbox.stub(ccloud, "hasCCloudAuthSession");
    hasCCloudAuthSessionStub.returns(false);
    ccloudLoaderStub = getStubbedCCloudResourceLoader(sandbox);
    getCatalogDatabaseFromMetadataStub = sandbox.stub(
      flinkSqlProvider,
      "getCatalogDatabaseFromMetadata",
    );

    resourceManagerStub = sandbox.createStubInstance(ResourceManager);
    sandbox.stub(ResourceManager, "getInstance").returns(resourceManagerStub);
    const pool: CCloudFlinkComputePool = TEST_CCLOUD_FLINK_COMPUTE_POOL;
    const database: CCloudKafkaCluster = TEST_CCLOUD_KAFKA_CLUSTER;
    // simulate stored compute pool + database metadata
    resourceManagerStub.getUriMetadata.resolves({
      [UriMetadataKeys.FLINK_COMPUTE_POOL_ID]: pool.id,
      [UriMetadataKeys.FLINK_DATABASE_ID]: database.id,
    });
    const envWithPool: CCloudEnvironment = new CCloudEnvironment({
      ...TEST_CCLOUD_ENVIRONMENT,
      flinkComputePools: [pool],
    });
    ccloudLoaderStub.getEnvironments.resolves([envWithPool]);
    ccloudLoaderStub.getOrganization.resolves(TEST_CCLOUD_ORGANIZATION);
    flinkManager = FlinkLanguageClientManager.getInstance();
  });

  afterEach(() => {
    flinkManager.dispose();
    FlinkLanguageClientManager["instance"] = null;
    sandbox.restore();
  });

  describe("constructor", () => {
    it("should initialize with empty openFlinkSqlDocuments set if no open documents found", () => {
      assert.strictEqual(flinkManager["openFlinkSqlDocuments"].size, 0);
    });

    it("should initialize with non-empty openFlinkSqlDocuments set if appropriate open documents found", () => {
      // Stub the workspace.textDocuments to return a document with flinksql language id
      const fakeUri = vscode.Uri.parse("file:///fake/path/test.flinksql");
      const fakeDocument = {
        languageId: FLINKSQL_LANGUAGE_ID,
        uri: fakeUri,
      } as vscode.TextDocument;
      sandbox.stub(vscode.workspace, "textDocuments").value([fakeDocument]);

      // Re-initialize the singleton so the constructor runs
      // dispose of existing instance to ensure we start fresh
      flinkManager.dispose();
      FlinkLanguageClientManager["instance"] = null;
      flinkManager = FlinkLanguageClientManager.getInstance();

      assert.strictEqual(flinkManager["openFlinkSqlDocuments"].size, 1);
    });

    it("should have disposables initialized", () => {
      assert.ok(flinkManager["disposables"]);
      assert.ok(flinkManager["disposables"].length > 4);
    });

    it("should set the lastDocUri to null initially", () => {
      assert.strictEqual(flinkManager["lastDocUri"], null);
    });
  });

  describe("isAppropriateDocument", () => {
    for (const goodScheme of ["file", "untitled"]) {
      it(`should return true for Flink SQL + ${goodScheme} documents`, () => {
        const uri = vscode.Uri.parse(`${goodScheme}:///test.flink.sql`);
        const document = { languageId: FLINKSQL_LANGUAGE_ID, uri } as vscode.TextDocument;
        assert.strictEqual(flinkManager.isAppropriateDocument(document), true);
      });
    }

    it("should return false for plaintext file documents", () => {
      const uri = vscode.Uri.parse("file:///test.txt");
      const document = { languageId: "plaintext", uri } as vscode.TextDocument;
      assert.strictEqual(flinkManager.isAppropriateDocument(document), false);
    });

    it("should return false for read-only FlinkStatement URIs", () => {
      const uri = vscode.Uri.parse(`${FLINKSTATEMENT_URI_SCHEME}://test-statement`);
      const document = { languageId: FLINKSQL_LANGUAGE_ID, uri } as vscode.TextDocument;
      assert.strictEqual(flinkManager.isAppropriateDocument(document), false);
    });
  });

  describe("isAppropriateUri", () => {
    for (const goodScheme of ["file", "untitled"]) {
      it(`should return true for Flink SQL + ${goodScheme} URIs`, () => {
        const uri = vscode.Uri.parse(`${goodScheme}:///test.flink.sql`);
        assert.strictEqual(flinkManager.isAppropriateUri(uri), true);
      });
    }

    it("should return false for read-only FlinkStatement URIs", () => {
      const uri = vscode.Uri.parse(`${FLINKSTATEMENT_URI_SCHEME}://test-statement`);
      assert.strictEqual(flinkManager.isAppropriateUri(uri), false);
    });
  });

  describe("validateFlinkSettings", () => {
    it("should return false when no computePoolId is provided", async () => {
      const result = await flinkManager.validateFlinkSettings(null);
      assert.strictEqual(result, false);
    });

    it("should return false when no ccloud environments", async () => {
      ccloudLoaderStub.getEnvironments.resolves([]);

      const result = await flinkManager.validateFlinkSettings("pool-id");
      assert.strictEqual(result, false);
    });

    it("should return false when cannot find the given computePoolId in environments", async () => {
      // valid default compute pool
      ccloudLoaderStub.getEnvironments.resolves([
        new CCloudEnvironment({
          ...TEST_CCLOUD_ENVIRONMENT,
          // No flinkComputePools set
        }),
      ]);

      const result = await flinkManager.validateFlinkSettings(TEST_CCLOUD_FLINK_COMPUTE_POOL_ID);
      assert.strictEqual(result, false);
    });

    it("should return false when cannot find the given computePoolId", async () => {
      // valid default compute pool
      ccloudLoaderStub.getEnvironments.resolves([
        new CCloudEnvironment({
          ...TEST_CCLOUD_ENVIRONMENT,
          // No flinkComputePools set
        }),
        new CCloudEnvironment({
          ...TEST_CCLOUD_ENVIRONMENT,
          flinkComputePools: [TEST_CCLOUD_FLINK_COMPUTE_POOL],
        }),
      ]);

      const result = await flinkManager.validateFlinkSettings(TEST_CCLOUD_FLINK_COMPUTE_POOL_ID);
      assert.strictEqual(result, true);
    });

    it("should return false if an error occurs while checking compute pool availability", async () => {
      ccloudLoaderStub.getEnvironments.rejects(new Error("Test error"));

      const result = await flinkManager.validateFlinkSettings(TEST_CCLOUD_FLINK_COMPUTE_POOL_ID);
      assert.strictEqual(result, false);
    });
  });

  describe("getFlinkSqlSettings", () => {
    it("should return null for all settings if not configured", async () => {
      stubbedConfigs.stubGet(FLINK_CONFIG_COMPUTE_POOL, "").stubGet(FLINK_CONFIG_DATABASE, "");
      resourceManagerStub.getUriMetadata.resolves(undefined);

      const settings = await flinkManager.getFlinkSqlSettings(TEST_FILE_URI);

      assert.deepStrictEqual(settings, {
        computePoolId: null,
        databaseName: null,
        catalogName: null,
      });
    });

    it("should return configs from workspace if set and uri metadata is undefined", async () => {
      stubbedConfigs
        .stubGet(FLINK_CONFIG_COMPUTE_POOL, "config-pool-id")
        .stubGet(FLINK_CONFIG_DATABASE, "config-db-id");
      resourceManagerStub.getUriMetadata.resolves(undefined);

      const settings = await flinkManager.getFlinkSqlSettings(TEST_FILE_URI);

      assert.deepStrictEqual(settings, {
        computePoolId: "config-pool-id",
        // these are correctly null since fake DB id yields no results in getCatalogDatabaseFromMetadataStub
        databaseName: null,
        catalogName: null,
      });
    });

    it("should return db and catalog names with settings if found", async () => {
      stubbedConfigs
        .stubGet(FLINK_CONFIG_COMPUTE_POOL, TEST_CCLOUD_FLINK_COMPUTE_POOL_ID)
        .stubGet(FLINK_CONFIG_DATABASE, "test-db");
      resourceManagerStub.getUriMetadata.resolves(undefined);

      // Mock the getCatalogDatabaseFromMetadata function to return catalog and database names
      getCatalogDatabaseFromMetadataStub.resolves({
        catalog: { name: "test-catalog-name" },
        database: { name: "test-db-name" },
      });

      const settings = await flinkManager.getFlinkSqlSettings(TEST_FILE_URI);

      sinon.assert.calledOnce(getCatalogDatabaseFromMetadataStub);
      assert.deepStrictEqual(settings, {
        computePoolId: TEST_CCLOUD_FLINK_COMPUTE_POOL_ID,
        databaseName: "test-db-name",
        catalogName: "test-catalog-name",
      });
    });

    it("should prioritize URI metadata over workspace config settings", async () => {
      stubbedConfigs
        .stubGet(FLINK_CONFIG_COMPUTE_POOL, "config-pool")
        .stubGet(FLINK_CONFIG_DATABASE, "config-db");
      resourceManagerStub.getUriMetadata.resolves({
        flinkComputePoolId: "metadata-pool",
        flinkDatabaseId: "metadata-db",
      });

      getCatalogDatabaseFromMetadataStub.resolves({
        catalog: { name: "metadata-catalog-name" },
        database: { name: "metadata-db-name" },
      });

      const settings = await flinkManager.getFlinkSqlSettings(TEST_FILE_URI);

      assert.deepStrictEqual(settings, {
        computePoolId: "metadata-pool",
        databaseName: "metadata-db-name",
        catalogName: "metadata-catalog-name",
      });
      sinon.assert.calledOnce(resourceManagerStub.getUriMetadata);
      sinon.assert.calledOnce(getCatalogDatabaseFromMetadataStub);
    });
  });

  describe("document tracking", () => {
    it("should add open flink documents to the tracking set when initializing", () => {
      const fakeUri = vscode.Uri.parse("file:///fake/path/test.flinksql");
      const fakeDocument = { languageId: "flinksql", uri: fakeUri } as vscode.TextDocument;
      sandbox.stub(vscode.workspace, "textDocuments").value([fakeDocument]);

      // Re-initialize the singleton so the constructor runs
      // dispose of existing instance to ensure we start fresh
      flinkManager.dispose();

      FlinkLanguageClientManager["instance"] = null;
      flinkManager = FlinkLanguageClientManager.getInstance();

      assert.strictEqual(flinkManager["openFlinkSqlDocuments"].size, 1);
      assert.strictEqual(flinkManager["openFlinkSqlDocuments"].has(fakeUri.toString()), true);
    });

    it("should track documents when opened", () => {
      const fakeUri = vscode.Uri.parse("file:///fake/path/test.flinksql");
      const fakeDocument = { languageId: "flinksql", uri: fakeUri } as vscode.TextDocument;
      sandbox.stub(vscode.workspace, "textDocuments").value([fakeDocument]);

      flinkManager.trackDocument(fakeUri);

      assert.strictEqual(flinkManager["openFlinkSqlDocuments"].size, 1);
      assert.strictEqual(flinkManager["openFlinkSqlDocuments"].has(fakeUri.toString()), true);
    });

    it("should untrack documents when closed", () => {
      const fakeUri = vscode.Uri.parse("file:///fake/path/test.flinksql");
      flinkManager.trackDocument(fakeUri);
      flinkManager.untrackDocument(fakeUri);

      assert.strictEqual(flinkManager["openFlinkSqlDocuments"].size, 0);
      assert.strictEqual(flinkManager["openFlinkSqlDocuments"].has(fakeUri.toString()), false);
    });
  });

  describe("initializeLanguageClient", () => {
    let secretStorageStub: StubbedSecretStorage;

    beforeEach(() => {
      secretStorageStub = getStubbedSecretStorage(sandbox);
    });

    describe("unit tests", () => {
      it("logs error and returns null if no sidecar auth token is found", async () => {
        secretStorageStub.get.withArgs(SecretStorageKeys.SIDECAR_AUTH_TOKEN).resolves(undefined);
        // @ts-expect-error calling private method for testing
        const result = await flinkManager.initializeLanguageClient("ws://localhost:8080");

        assert.strictEqual(result, null, "Expected result to be null when no auth token is found");
      });
    });

    /** Tests involving a locally hosted websocket server simulating different sidecar behavior. */
    describe("integration tests", function () {
      // These tests may take longer to run due to server startup
      this.timeout(5000);

      let wss: WebSocketServer;
      let serverUrl: string;
      let handleWebSocketDisconnectStub: sinon.SinonSpy;
      let mockAccessToken: string;

      // stub out createLanguageClientFromWebsocket().
      let createLanguageClientFromWebsocketStub: sinon.SinonStub;

      // @ts-expect-error obviously wrong type, but we are stubbing this out as the return
      // result from createLanguageClientFromWebsocketStub.
      const fakeLanguageClient = { fake_language_client: true } as LanguageClient;

      beforeEach(async () => {
        // Set up WebSocket server
        wss = new WebSocketServer({ port: 0 }); // Use port 0 for automatic port assignment

        // Get the server url / actual port assigned by the OS
        serverUrl = await new Promise<string>((resolve) => {
          wss.on("listening", () => {
            const address = wss.address() as AddressInfo;
            const serverPort = address.port;
            resolve(`ws://localhost:${serverPort}`);
          });
        });

        // Set up secret storage stub with mock token
        mockAccessToken = "mock-access-token";
        secretStorageStub.get
          .withArgs(SecretStorageKeys.SIDECAR_AUTH_TOKEN)
          .resolves(mockAccessToken);

        // Stub for on disconnect callback passed to initializeLanguageClient()
        handleWebSocketDisconnectStub = sandbox.stub(
          flinkManager as any,
          "handleWebSocketDisconnect",
        );

        createLanguageClientFromWebsocketStub = sandbox
          .stub(languageClient, "createLanguageClientFromWebsocket")
          .resolves(fakeLanguageClient);
      });

      afterEach(async () => {
        if (wss) {
          wss.close();
        }
      });

      it("should successfully connect and create language client when server sends 'OK'", async () => {
        // Set up connection handler to validate token and send "OK" message
        wss.on("connection", (ws, req) => {
          const authHeader = req.headers.authorization;
          assert.strictEqual(
            authHeader,
            `Bearer ${mockAccessToken}`,
            "WebSocket connection should include correct authorization header",
          );

          // After 100s, send the "OK" message to trigger language client creation as if
          // sidecar had made the peer connection to ccloud.
          // Then 1000s after that,close the connection normally.
          setTimeout(() => {
            ws.send("OK");

            // After a brief delay, simulate normal close from the server side.
            setTimeout(() => {
              ws.close(1000, "Test completed successfully");
            }, 1000);
          }, 100);
        });

        // Wait for the client to be created. Should go through the 'OK' handshaking with
        // the fake WebSocket server.
        // @ts-expect-error calling private method for testing
        const client = await flinkManager.initializeLanguageClient(serverUrl);

        assert.deepEqual(client, fakeLanguageClient, "Expected client to be created successfully");
        sinon.assert.calledOnce(createLanguageClientFromWebsocketStub);

        // flinkManager.initializeLanguageClient() should have returned what
        // createLanguageClientFromWebsocket() resolved to.
        assert.deepEqual(client, fakeLanguageClient);

        // The disconnect callback will not have been called for a normal close
        // since the handler wasn't wired in until real LanguageClient creation
        // (which we've mocked out for these tests, but perhaps should have been
        // wired in regardless). Perhps this behavior needs reconsideration in
        // future branches --- if we get a close before the 'OK' handling, when
        // does the overall behavior cause FlinkLanguageClientManager to
        // reconnect / try again?
        sinon.assert.notCalled(handleWebSocketDisconnectStub);
      });

      it("should reject and log error if createLanguageClientFromWebsocket rejects", async () => {
        // Set up connection handler to send "OK" message
        wss.on("connection", (ws) => {
          setTimeout(() => {
            ws.send("OK");
            setTimeout(() => {
              ws.close(1000, "Test completed with createLanguageClientFromWebsocket rejection");
            }, 100);
          }, 100);
        });

        // Make createLanguageClientFromWebsocket reject
        const rejectionError = new Error("Failed to create language client");
        createLanguageClientFromWebsocketStub.rejects(rejectionError);

        // @ts-expect-error calling private method for testing
        const resultPromise = flinkManager.initializeLanguageClient(serverUrl);

        await assert.rejects(
          resultPromise,
          (err: Error) => err === rejectionError,
          "Expected rejection from createLanguageClientFromWebsocket",
        );
      });

      it("should reject and log error if server does not send 'OK' as first message", async () => {
        // Set up connection handler to send a non-OK message
        wss.on("connection", (ws) => {
          // Send the client a message that is not "OK"
          setTimeout(() => {
            ws.send("NOT_OK");
            // Then close the connection
            setTimeout(() => {
              ws.close(1000, "Test completed with NOT_OK");
            }, 100);
          }, 100);
        });

        // @ts-expect-error calling private method for testing
        const resultPromise = flinkManager.initializeLanguageClient(serverUrl);

        // Should reject with an error
        await assert.rejects(
          resultPromise,
          (err: Error) =>
            err.message.includes("Unexpected message received from WebSocket instead of OK"),
          "Expected rejection due to missing OK message",
        );

        sinon.assert.notCalled(createLanguageClientFromWebsocketStub);
        sinon.assert.notCalled(handleWebSocketDisconnectStub);
      });

      it("should reject and log error if server closes connection with non-1000 code before OK", async () => {
        // Set up connection handler to close with non-1000 code before sending "OK"
        wss.on("connection", (ws) => {
          setTimeout(() => {
            ws.close(4001, "Abnormal closure for test");
          }, 100);
        });

        // @ts-expect-error calling private method for testing
        const resultPromise = flinkManager.initializeLanguageClient(serverUrl);

        await assert.rejects(
          resultPromise,
          (err: Error) =>
            err.message.includes("WebSocket closed before initialization") ||
            err.message.includes("Abnormal closure for test"),
          "Expected rejection due to abnormal WebSocket closure",
        );

        sinon.assert.notCalled(createLanguageClientFromWebsocketStub);
        sinon.assert.notCalled(handleWebSocketDisconnectStub);
      });
    });
  });

  describe("setEventListeners", () => {
    // Define test cases as corresponding tuples of
    // [which event emitter stub container, event emitter name, language client event handler method name]
    const eventEmitterHandlerTuples: Array<
      [
        "vscode" | "custom",
        keyof StubbedEventEmitters | keyof VscodeEventRegistrationStubs,
        keyof FlinkLanguageClientManager,
      ]
    > = [
      ["custom", "ccloudConnected", "ccloudConnectedHandler"],
      ["custom", "uriMetadataSet", "uriMetadataSetHandler"],
      ["vscode", "onDidOpenTextDocumentStub", "onDidOpenTextDocumentHandler"],
      ["vscode", "onDidCloseTextDocumentStub", "onDidCloseTextDocumentHandler"],
      ["vscode", "onDidChangeTextDocumentStub", "onDidChangeTextDocumentHandler"],
      ["vscode", "onDidChangeActiveTextEditorStub", "onDidChangeActiveTextEditorHandler"],
    ];

    let emitterStubs: StubbedEventEmitters;
    let vscodeStubs: VscodeEventRegistrationStubs;

    beforeEach(() => {
      // Stub all event emitters in the emitters module
      emitterStubs = eventEmitterStubs(sandbox);
      // and also stub the common vscode event handler registration functions
      vscodeStubs = vscodeEventRegistrationStubs(sandbox);
    });

    it("setEventListeners() + setCustomEventListeners() should return the expected number of listeners", () => {
      const listeners = flinkManager["setEventListeners"]();
      assert.strictEqual(listeners.length, eventEmitterHandlerTuples.length);
    });

    eventEmitterHandlerTuples.forEach(([eventType, emitterName, handlerMethodName]) => {
      it(`should register the proper handler ${handlerMethodName} for ${eventType} event emitter ${emitterName}`, () => {
        // Create stub for the event handler method on our manager instance.
        const handlerStub = sandbox.stub(flinkManager, handlerMethodName);

        // Re-invoke setEventListeners() to capture emitter .event() stub calls
        // @ts-expect-error calling protected method.
        flinkManager.setEventListeners();

        // Grab the corresponding emitter stub from either `emitterStubs` or `vscodeStubs` based on the event class (from vscode or one of our custom emitters)
        const handlerRegistrationStub =
          eventType === "custom"
            ? (emitterStubs as any)[emitterName]!.event // custom emitters have stubbed instances. We're interested in its .event() stubbed method.
            : (vscodeStubs as any)[emitterName]!; // core vscode event handlers are stub functions over event() already, not stubbed instances.

        // Verify the emitter'sregistration method was called -- that something was registered as a handler
        sinon.assert.calledOnce(handlerRegistrationStub);

        // Capture the handler function that was registered
        const registeredHandler = handlerRegistrationStub.firstCall.args[0];

        // Call the handler that was registered ...
        registeredHandler();

        // Verify the expected method stub was called,
        // proving that the expected handler was registered
        // to the expected emitter.
        sinon.assert.calledOnce(handlerStub);
      });
    });
  });

  describe("simulateDocumentChangeToTriggerDiagnostics", () => {
    let fakeLanguageClient: sinon.SinonStubbedInstance<LanguageClient>;
    let fakeDoc: any;
    let sendNotificationStub: sinon.SinonStub;

    beforeEach(() => {
      fakeLanguageClient = sandbox.createStubInstance(LanguageClient);
      flinkManager["languageClient"] = fakeLanguageClient;

      // content doesn't matter here, we just need uri/version/text for .sendNotification checks
      fakeDoc = {
        uri: { toString: () => "file:///test/path.sql" },
        version: 7,
        getText: sinon.stub().returns("SELECT * FROM foo;"),
      };
      sendNotificationStub = sandbox.stub();
      flinkManager["languageClient"].sendNotification = sendNotificationStub;
    });

    it("should do nothing if languageClient is null", async () => {
      flinkManager["languageClient"] = null;

      await flinkManager.simulateDocumentChangeToTriggerDiagnostics(fakeDoc);

      sinon.assert.notCalled(sendNotificationStub);
    });

    it("should call sendNotification with correct params if languageClient is set", async () => {
      await flinkManager.simulateDocumentChangeToTriggerDiagnostics(fakeDoc);

      sinon.assert.calledOnce(sendNotificationStub);
      const [method, payload] = sendNotificationStub.firstCall.args;
      assert.strictEqual(method, "textDocument/didChange");
      assert.strictEqual(payload.textDocument.uri, fakeDoc.uri.toString());
      assert.strictEqual(payload.textDocument.version, fakeDoc.version);
      assert.deepStrictEqual(payload.contentChanges, [{ text: fakeDoc.getText() }]);
    });

    it("should handle empty document Uri strings gracefully", async () => {
      fakeDoc.uri = { toString: () => "" };

      await flinkManager.simulateDocumentChangeToTriggerDiagnostics(fakeDoc);

      sinon.assert.calledOnce(sendNotificationStub);
      const payload = sendNotificationStub.firstCall.args[1];
      assert.strictEqual(payload.textDocument.uri, "");
    });

    it("should propagate errors from sendNotification", async () => {
      const fakeError = new Error("uh oh");
      sendNotificationStub.rejects(fakeError);

      await assert.rejects(
        async () => await flinkManager.simulateDocumentChangeToTriggerDiagnostics(fakeDoc),
        fakeError,
      );
    });
  });

  describe("maybeStartLanguageClient", () => {
    let getFlinkSqlSettingsStub: sinon.SinonStub;
    let validateFlinkSettingsStub: sinon.SinonStub;
    let buildFlinkSqlWebSocketUrlStub: sinon.SinonStub;
    let isLanguageClientConnectedStub: sinon.SinonStub;
    let cleanupLanguageClientStub: sinon.SinonStub;
    let clearDiagnosticsStub: sinon.SinonStub;
    let initializeLanguageClientStub: sinon.SinonStub;
    let notifyConfigChangedStub: sinon.SinonStub;
    let simulateDocumentChangeToTriggerDiagnosticsStub: sinon.SinonStub;
    let workspaceTextDocumentsStub: sinon.SinonStub;

    beforeEach(() => {
      // simulate authenticated CCloud connection by default
      hasCCloudAuthSessionStub.returns(true);

      getFlinkSqlSettingsStub = sandbox.stub(flinkManager, "getFlinkSqlSettings");
      getFlinkSqlSettingsStub.resolves({ computePoolId: TEST_CCLOUD_FLINK_COMPUTE_POOL_ID });

      validateFlinkSettingsStub = sandbox.stub(flinkManager, "validateFlinkSettings");
      validateFlinkSettingsStub.resolves(true);

      buildFlinkSqlWebSocketUrlStub = sandbox.stub(
        flinkManager as any,
        "buildFlinkSqlWebSocketUrl",
      );
      buildFlinkSqlWebSocketUrlStub.returns("ws://localhost:8080/test");

      isLanguageClientConnectedStub = sandbox.stub(
        flinkManager as any,
        "isLanguageClientConnected",
      );
      isLanguageClientConnectedStub.returns(false);

      cleanupLanguageClientStub = sandbox.stub().resolves();
      flinkManager["cleanupLanguageClient"] = cleanupLanguageClientStub;

      clearDiagnosticsStub = sandbox.stub().resolves();
      flinkManager["clearDiagnostics"] = clearDiagnosticsStub;

      const fakeLanguageClient = sandbox.createStubInstance(LanguageClient);
      initializeLanguageClientStub = sandbox.stub().resolves(fakeLanguageClient);
      flinkManager["initializeLanguageClient"] = initializeLanguageClientStub;

      notifyConfigChangedStub = sandbox.stub().resolves();
      flinkManager["notifyConfigChanged"] = notifyConfigChangedStub;

      simulateDocumentChangeToTriggerDiagnosticsStub = sandbox.stub().resolves();
      flinkManager["simulateDocumentChangeToTriggerDiagnostics"] =
        simulateDocumentChangeToTriggerDiagnosticsStub;

      workspaceTextDocumentsStub = sandbox.stub(vscode.workspace, "textDocuments").value([]);

      // start with a fresh slate
      flinkManager["languageClient"] = null;
      flinkManager["lastDocUri"] = null;
      flinkManager["lastWebSocketUrl"] = null;
      flinkManager["reconnectCounter"] = 0;
    });

    it("should return early if the user doesn't have an authenticated CCloud connection", async () => {
      hasCCloudAuthSessionStub.returns(false);

      await flinkManager.maybeStartLanguageClient(TEST_FILE_URI);

      sinon.assert.notCalled(getFlinkSqlSettingsStub);
      sinon.assert.notCalled(initializeLanguageClientStub);
    });

    it("should return early if no URI is provided", async () => {
      await flinkManager.maybeStartLanguageClient();

      sinon.assert.notCalled(getFlinkSqlSettingsStub);
      sinon.assert.notCalled(initializeLanguageClientStub);
    });

    // the "Language client already exists for this [document] URI" scenario
    it("should return early if the language client exists for the same URI and restartRunningClient=false", async () => {
      isLanguageClientConnectedStub.returns(true);
      flinkManager["lastDocUri"] = TEST_FILE_URI;

      await flinkManager.maybeStartLanguageClient(TEST_FILE_URI, false); // no forced restart

      sinon.assert.notCalled(getFlinkSqlSettingsStub);
      sinon.assert.notCalled(initializeLanguageClientStub);
    });

    it("should call initializeLanguageClient() if the language client exists for the same document URI and restartRunningClient=true", async () => {
      isLanguageClientConnectedStub.returns(true);
      flinkManager["lastDocUri"] = TEST_FILE_URI;

      await flinkManager.maybeStartLanguageClient(TEST_FILE_URI, true); // forced restart

      sinon.assert.calledOnce(getFlinkSqlSettingsStub);
      sinon.assert.calledOnce(cleanupLanguageClientStub);
      sinon.assert.calledOnce(initializeLanguageClientStub);
    });

    it("should return early if no compute pool is set", async () => {
      getFlinkSqlSettingsStub.resolves({ computePoolId: null });

      await flinkManager.maybeStartLanguageClient(TEST_FILE_URI);

      sinon.assert.calledOnce(getFlinkSqlSettingsStub);
      sinon.assert.notCalled(validateFlinkSettingsStub);
      sinon.assert.notCalled(initializeLanguageClientStub);
    });

    it("should return early if compute pool validation fails", async () => {
      validateFlinkSettingsStub.resolves(false);

      await flinkManager.maybeStartLanguageClient(TEST_FILE_URI);

      sinon.assert.calledOnce(getFlinkSqlSettingsStub);
      sinon.assert.calledOnce(validateFlinkSettingsStub);
      sinon.assert.notCalled(buildFlinkSqlWebSocketUrlStub);
      sinon.assert.notCalled(initializeLanguageClientStub);
    });

    it("should return early if WebSocket URL building fails", async () => {
      // if .lookupComputePoolInfo() returns null for various reasons
      buildFlinkSqlWebSocketUrlStub.returns(null);

      await flinkManager.maybeStartLanguageClient(TEST_FILE_URI);

      sinon.assert.calledOnce(buildFlinkSqlWebSocketUrlStub);
      sinon.assert.notCalled(initializeLanguageClientStub);
    });

    it("should return early if WebSocket URL building returns null", async () => {
      // like if .lookupComputePoolInfo() returns null for various reasons
      buildFlinkSqlWebSocketUrlStub.returns(null);

      await flinkManager.maybeStartLanguageClient(TEST_FILE_URI);

      sinon.assert.calledOnce(buildFlinkSqlWebSocketUrlStub);
      sinon.assert.notCalled(initializeLanguageClientStub);
    });

    // the "Language client already connected to correct [websocket] url" scenario
    it("should return early if the language client is already connected to the same WebSocket URL and restartRunningClient=false", async () => {
      const testUrl = "ws://localhost:8080/test";
      isLanguageClientConnectedStub.returns(true);
      flinkManager["lastWebSocketUrl"] = testUrl;
      buildFlinkSqlWebSocketUrlStub.returns(testUrl);

      await flinkManager.maybeStartLanguageClient(TEST_FILE_URI, false); // no forced restart

      sinon.assert.calledOnce(buildFlinkSqlWebSocketUrlStub);
      sinon.assert.notCalled(cleanupLanguageClientStub);
      sinon.assert.notCalled(initializeLanguageClientStub);
    });

    it("should cleanup and reinitialize if the language client is connected but the WebSocket URL changed", async () => {
      const oldUrl = "ws://localhost:8080/old";
      const newUrl = "ws://localhost:8080/new";
      isLanguageClientConnectedStub.returns(true);
      flinkManager["lastWebSocketUrl"] = oldUrl;
      buildFlinkSqlWebSocketUrlStub.returns(newUrl);

      await flinkManager.maybeStartLanguageClient(TEST_FILE_URI);

      sinon.assert.calledOnce(cleanupLanguageClientStub);
      sinon.assert.calledOnce(initializeLanguageClientStub);
      sinon.assert.calledWith(initializeLanguageClientStub, newUrl);
      // verify that the cleanup happens before reinitialization
      sinon.assert.callOrder(cleanupLanguageClientStub, initializeLanguageClientStub);
    });

    it("should successfully initialize the language client with valid settings", async () => {
      const testUrl = "ws://localhost:8080/test";
      buildFlinkSqlWebSocketUrlStub.returns(testUrl);

      await flinkManager.maybeStartLanguageClient(TEST_FILE_URI);

      sinon.assert.calledOnce(getFlinkSqlSettingsStub);
      sinon.assert.calledOnce(validateFlinkSettingsStub);
      sinon.assert.calledOnce(buildFlinkSqlWebSocketUrlStub);
      sinon.assert.calledOnce(initializeLanguageClientStub);
      sinon.assert.calledWith(initializeLanguageClientStub, testUrl);
      sinon.assert.calledOnce(notifyConfigChangedStub);
      // verify internal state is properly set
      assert.strictEqual(flinkManager["lastDocUri"], TEST_FILE_URI);
      assert.strictEqual(flinkManager["lastWebSocketUrl"], testUrl);
      assert.strictEqual(flinkManager["reconnectCounter"], 0);
    });

    it("should call .clearDiagnostics() for the previous document if it exists", async () => {
      const previousUri = vscode.Uri.parse("file:///previous.flink.sql");
      flinkManager["lastDocUri"] = previousUri;

      await flinkManager.maybeStartLanguageClient(TEST_FILE_URI);

      sinon.assert.calledOnce(clearDiagnosticsStub);
      sinon.assert.calledWith(clearDiagnosticsStub, previousUri);
    });

    it("should not call .clearDiagnostics() if no previous document exists", async () => {
      flinkManager["lastDocUri"] = null;

      await flinkManager.maybeStartLanguageClient(TEST_FILE_URI);

      sinon.assert.notCalled(clearDiagnosticsStub);
    });

    it("should call simulateDocumentChangeToTriggerDiagnostics() in finally block when client is created", async () => {
      const testDocument = {
        uri: TEST_FILE_URI,
        languageId: FLINKSQL_LANGUAGE_ID,
      } as vscode.TextDocument;
      workspaceTextDocumentsStub.value([testDocument]);

      await flinkManager.maybeStartLanguageClient(TEST_FILE_URI);

      sinon.assert.calledOnce(simulateDocumentChangeToTriggerDiagnosticsStub);
      sinon.assert.calledWith(simulateDocumentChangeToTriggerDiagnosticsStub, testDocument);
    });

    it("should not call simulateDocumentChangeToTriggerDiagnostics() if no matching document is found", async () => {
      const otherDocument = {
        uri: vscode.Uri.parse("file:///other.flink.sql"),
        languageId: FLINKSQL_LANGUAGE_ID,
      } as vscode.TextDocument;
      workspaceTextDocumentsStub.value([otherDocument]);

      await flinkManager.maybeStartLanguageClient(TEST_FILE_URI);

      sinon.assert.notCalled(simulateDocumentChangeToTriggerDiagnosticsStub);
    });

    it("should not call simulateDocumentChangeToTriggerDiagnostics() if no language client exists", async () => {
      initializeLanguageClientStub.resolves(null);

      await flinkManager.maybeStartLanguageClient(TEST_FILE_URI);

      sinon.assert.notCalled(simulateDocumentChangeToTriggerDiagnosticsStub);
    });

    it("should handle errors and still call simulateDocumentChangeToTriggerDiagnostics() in the finally block", async () => {
      flinkManager["languageClient"] = sandbox.createStubInstance(LanguageClient);
      const testDocument = {
        uri: TEST_FILE_URI,
        languageId: FLINKSQL_LANGUAGE_ID,
      } as vscode.TextDocument;
      workspaceTextDocumentsStub.value([testDocument]);
      const testError = new Error("Test error");
      getFlinkSqlSettingsStub.rejects(testError);

      // error shouldn't propagate, just get logged
      await flinkManager.maybeStartLanguageClient(TEST_FILE_URI);

      sinon.assert.calledOnce(getFlinkSqlSettingsStub);
      sinon.assert.notCalled(initializeLanguageClientStub);
      sinon.assert.calledOnce(simulateDocumentChangeToTriggerDiagnosticsStub);
    });

    it("should not add language client to .disposables if initializeLanguageClient() returns null", async () => {
      initializeLanguageClientStub.resolves(null);
      const disposablesSizeBefore = flinkManager["disposables"].length;

      await flinkManager.maybeStartLanguageClient(TEST_FILE_URI);

      assert.strictEqual(flinkManager["disposables"].length, disposablesSizeBefore);
      assert.strictEqual(flinkManager["languageClient"], null);
      sinon.assert.notCalled(notifyConfigChangedStub);
    });
  });

  describe("Event handling", () => {
    let maybeStartLanguageClientStub: sinon.SinonStub;

    const goodFlinkUri = vscode.Uri.parse("file:///fake/path/test.flinksql");
    const goodFlinkDocument = {
      languageId: FLINKSQL_LANGUAGE_ID,
      uri: goodFlinkUri,
    } as vscode.TextDocument;

    const wrongLanguageIdDocument = {
      languageId: "plaintext",
      uri: goodFlinkUri,
    } as vscode.TextDocument;

    // Used to control what window.activeTextEditor will be in tests
    let returnedActiveTextEditor: vscode.TextEditor | undefined = undefined;

    // Likewise for window.visibleTextEditors, defaulting to an empty array
    let returnedVisibleTextEditors: vscode.TextEditor[] = [];

    beforeEach(() => {
      maybeStartLanguageClientStub = sandbox
        .stub(flinkManager as any, "maybeStartLanguageClient")
        .resolves();

      // Stub the activeTextEditor to control its value in tests. Defaults to undefined, 'no active editor'.
      sandbox.stub(vscode.window, "activeTextEditor").get(() => returnedActiveTextEditor);

      // Stub the visibleTextEditors to control its value in tests. Defaults to an empty array, 'no visible editors'.
      sandbox.stub(vscode.window, "visibleTextEditors").get(() => returnedVisibleTextEditors);
    });

    afterEach(() => {
      // Reset these outside-of-sandbox stub results.
      returnedActiveTextEditor = undefined;
      returnedVisibleTextEditors = [];
    });

    describe("uriMetadataSetHandler", () => {
      let notifyConfigChangedStub: sinon.SinonStub;
      let openTextDocumentStub: sinon.SinonStub;
      let restartLanguageClientStub: sinon.SinonStub;
      let buildFlinkSqlWebSocketUrlStub: sinon.SinonStub;
      let getFlinkSqlSettingsStub: sinon.SinonStub;

      beforeEach(() => {
        notifyConfigChangedStub = sandbox.stub(flinkManager as any, "notifyConfigChanged");
        openTextDocumentStub = sandbox.stub(vscode.workspace, "openTextDocument");
        restartLanguageClientStub = sandbox.stub(flinkManager as any, "restartLanguageClient");
        buildFlinkSqlWebSocketUrlStub = sandbox.stub(
          flinkManager as any,
          "buildFlinkSqlWebSocketUrl",
        );
        getFlinkSqlSettingsStub = sandbox.stub(flinkManager, "getFlinkSqlSettings").resolves({
          computePoolId: "computePool-id",
          databaseName: "test-db",
          catalogName: "test-catalog",
        });
      });

      it("should call restartLanguageClient if new metadata has computepool and implies new websocket url", async () => {
        // stub out .lookupComputePoolInfo() to return a valid compute pool info so buildFlinkSqlWebSocketUrl() will return a valid URL
        sandbox.stub(flinkManager as any, "lookupComputePoolInfo").resolves({
          organizationId: "test-org",
          environmentId: "test-env",
          region: "us-west-2",
          provider: "aws",
        });
        flinkManager["lastWebSocketUrl"] = "ws://old-url";
        // Just force set things up so that new call to buildFlinkSqlWebSocketUrl() will return a different URL.
        buildFlinkSqlWebSocketUrlStub.returns("ws://new-url");

        const uriString = "file:///fake/path/test.flinksql";
        const fakeUri = vscode.Uri.parse(uriString);
        flinkManager["lastDocUri"] = fakeUri;

        // By default up above, getFlinkSqlSettingsStub returns a valid compute pool id, so we should
        // restart the language client since it appears that the metadata change means
        // we need to connect to a different region / provider.

        await flinkManager.uriMetadataSetHandler(fakeUri);

        sinon.assert.calledOnce(restartLanguageClientStub);
      });

      it("should call notifyConfigChanged if new metadata lacks computepool", async () => {
        getFlinkSqlSettingsStub.resolves({
          computePoolId: undefined,
          databaseName: undefined,
          catalogName: undefined,
        });

        // Just force set things up so that new call to buildFlinkSqlWebSocketUrl() will return a different URL.
        flinkManager["lastWebSocketUrl"] = "ws://old-url";
        buildFlinkSqlWebSocketUrlStub.returns("ws://new-url");

        const uriString = "file:///fake/path/test.flinksql";
        const fakeUri = vscode.Uri.parse(uriString);
        flinkManager["lastDocUri"] = fakeUri;

        await flinkManager.uriMetadataSetHandler(fakeUri);

        // should not restart the language client, but notify config changed because no compute pool
        // to restart client against (?).
        sinon.assert.notCalled(restartLanguageClientStub);
        sinon.assert.calledOnce(notifyConfigChangedStub);
      });

      it("Should call notifyConfigChanged if current document matches metadata", async () => {
        const uriString = "file:///fake/path/test.flinksql";
        const fakeUri = vscode.Uri.parse(uriString);
        flinkManager["lastDocUri"] = fakeUri;

        // Set up to smell like metadata implies same websocket URL, but perhaps other bits changed.
        flinkManager["lastWebSocketUrl"] = "ws://same-url";
        buildFlinkSqlWebSocketUrlStub.returns("ws://same-url");

        // Make an equivalent Uri but separate instance.
        const equivMetadataUri = vscode.Uri.parse(uriString);

        await flinkManager.uriMetadataSetHandler(equivMetadataUri);

        sinon.assert.calledOnce(notifyConfigChangedStub);
        sinon.assert.notCalled(restartLanguageClientStub);
      });

      it("should call maybeStartLanguageClient if is new document and smells flinksql", async () => {
        const documentUri = vscode.Uri.parse("file:///fake/path/test.flinksql");
        flinkManager["lastDocUri"] = null; // No last document

        // as if perhaps they just set the language id from plaintext to flinksql
        openTextDocumentStub.resolves({
          languageId: "flinksql",
          uri: documentUri,
        } as vscode.TextDocument);

        await flinkManager.uriMetadataSetHandler(documentUri);

        sinon.assert.calledOnce(maybeStartLanguageClientStub);
        sinon.assert.calledWith(maybeStartLanguageClientStub, documentUri);
      });

      it("should not call maybeStartLanguageClient if new document is not flinksql-y", async () => {
        const documentUri = vscode.Uri.parse("file:///fake/path/test.txt");
        flinkManager["lastDocUri"] = null; // No last document

        openTextDocumentStub.resolves({
          languageId: "plaintext",
          uri: documentUri,
        } as vscode.TextDocument);

        await flinkManager.uriMetadataSetHandler(documentUri);

        sinon.assert.notCalled(maybeStartLanguageClientStub);
      });

      it("should not call maybeStartLanguageClient if new document is flinksql-y but not an appropriate uri", async () => {
        const documentUri = vscode.Uri.parse(`${FLINKSTATEMENT_URI_SCHEME}:///fake/path/test.txt`);
        flinkManager["lastDocUri"] = null; // No last document

        openTextDocumentStub.resolves({
          languageId: "flinksql",
          uri: documentUri,
        } as vscode.TextDocument);

        await flinkManager.uriMetadataSetHandler(documentUri);

        sinon.assert.notCalled(maybeStartLanguageClientStub);
      });
    });

    describe("onDidChangeActiveTextEditorHandler", () => {
      for (const goodScheme of ["file", "untitled"]) {
        it(`should call maybeStartLanguageClient for flinksql document in ${goodScheme} scheme`, () => {
          const fakeUri = vscode.Uri.parse(`${goodScheme}:///fake/path/test.flinksql`);
          const fakeDocument = {
            languageId: FLINKSQL_LANGUAGE_ID,
            uri: fakeUri,
          } as vscode.TextDocument;
          const fakeEditor = { document: fakeDocument } as vscode.TextEditor;

          // Simulate active editor change
          flinkManager.onDidChangeActiveTextEditorHandler(fakeEditor);

          sinon.assert.calledOnce(maybeStartLanguageClientStub);
          sinon.assert.calledWith(maybeStartLanguageClientStub, fakeUri);
        });
      }

      it("should not call maybeStartLanguageClient when active editor is not flinksql", () => {
        const fakeUri = vscode.Uri.parse("file:///fake/path/test.txt");
        const fakeDocument = { languageId: "plaintext", uri: fakeUri } as vscode.TextDocument;
        const fakeEditor = { document: fakeDocument } as vscode.TextEditor;

        // Simulate active editor change
        flinkManager.onDidChangeActiveTextEditorHandler(fakeEditor);

        sinon.assert.notCalled(maybeStartLanguageClientStub);
      });

      it("Should not call maybeStartLanguageClient when active editor is flinksql but not a valid uri", () => {
        const fakeUri = vscode.Uri.parse(`${FLINKSTATEMENT_URI_SCHEME}:///fake/path/test.flinksql`);
        const fakeDocument = {
          languageId: FLINKSQL_LANGUAGE_ID,
          uri: fakeUri,
        } as vscode.TextDocument;
        const fakeEditor = { document: fakeDocument } as vscode.TextEditor;

        // Simulate active editor change
        flinkManager.onDidChangeActiveTextEditorHandler(fakeEditor);

        sinon.assert.notCalled(maybeStartLanguageClientStub);
      });

      it("should not call when no active editor", () => {
        // Simulate no active editor
        flinkManager.onDidChangeActiveTextEditorHandler(undefined);

        sinon.assert.notCalled(maybeStartLanguageClientStub);
      });
    });

    describe("onDidOpenTextDocumentHandler", () => {
      let trackDocumentStub: sinon.SinonStub;

      beforeEach(() => {
        trackDocumentStub = sandbox.stub(flinkManager, "trackDocument");
      });

      it("should not call when non-flinksql document is opened", async () => {
        const fakeUri = vscode.Uri.parse("file:///fake/path/test.txt");
        const fakeDocument = {
          languageId: "plaintext",
          uri: fakeUri,
        } as vscode.TextDocument;

        await flinkManager.onDidOpenTextDocumentHandler(fakeDocument);

        sinon.assert.notCalled(maybeStartLanguageClientStub);
        sinon.assert.notCalled(trackDocumentStub);
      });

      it("Should not call maybeStartLanguageClient when flinksql document is opened but not the active editor", async () => {
        const fakeUri = vscode.Uri.parse("file:///fake/path/test.flinksql");
        const fakeDocument = {
          languageId: FLINKSQL_LANGUAGE_ID,
          uri: fakeUri,
        } as vscode.TextDocument;

        // set window.activeTextEditor getter to return a different document
        returnedActiveTextEditor = {
          document: {
            languageId: "plaintext",
            uri: vscode.Uri.parse("file:///other/path/test.txt"),
          },
        } as vscode.TextEditor;

        await flinkManager.onDidOpenTextDocumentHandler(fakeDocument);

        sinon.assert.notCalled(maybeStartLanguageClientStub);
        // but should have tracked the document
        sinon.assert.calledOnce(trackDocumentStub);
        sinon.assert.calledWith(trackDocumentStub, fakeUri);
      });

      for (const goodScheme of ["file", "untitled"]) {
        it(`should call maybeStartLanguageClient when a flinksql document is opened when no active editor at all: scheme ${goodScheme}`, async () => {
          const fakeUri = vscode.Uri.parse(`${goodScheme}:///fake/path/test.flinksql`);
          const fakeDocument = {
            languageId: FLINKSQL_LANGUAGE_ID,
            uri: fakeUri,
          } as vscode.TextDocument;

          // set window.activeTextEditor getter to return undefined
          returnedActiveTextEditor = undefined;

          await flinkManager.onDidOpenTextDocumentHandler(fakeDocument);

          sinon.assert.calledOnce(maybeStartLanguageClientStub);
          sinon.assert.calledWith(maybeStartLanguageClientStub, fakeUri);

          // should have tracked the document
          sinon.assert.calledOnce(trackDocumentStub);
          sinon.assert.calledWith(trackDocumentStub, fakeUri);
        });

        it(`should call maybeStartLanguageClient when open document changes language id: scheme ${goodScheme}`, async () => {
          const fakeUri = vscode.Uri.parse(`${goodScheme}:///fake/path/test.flinksql`);
          const fakeDocument = {
            languageId: FLINKSQL_LANGUAGE_ID,
            uri: fakeUri,
          } as vscode.TextDocument;

          // set window.activeTextEditor getter to return same document, but
          // with a different language id, as if this event is announcing
          // the language id change per onDidOpenTextDocument documentation.
          returnedActiveTextEditor = {
            document: {
              languageId: "plaintext",
              uri: fakeUri,
            },
          } as vscode.TextEditor;

          await flinkManager.onDidOpenTextDocumentHandler(fakeDocument);

          sinon.assert.calledOnce(maybeStartLanguageClientStub);
          sinon.assert.calledWith(maybeStartLanguageClientStub, fakeUri);
        });
      }
    });

    describe("onDidChangeTextDocumentHandler", () => {
      let fakeDiagnosticsCollection: FakeDiagnosticsCollection;

      beforeEach(() => {
        // wire a mock LanguageClient to the flinkManager
        const fakeLanguageClient = sandbox.createStubInstance(LanguageClient);

        // Reassign the read-only `diagnostics` property of the language client
        fakeDiagnosticsCollection = new FakeDiagnosticsCollection(sandbox);
        Object.defineProperty(fakeLanguageClient, "diagnostics", {
          value: fakeDiagnosticsCollection,
          configurable: true,
        });

        flinkManager["languageClient"] = fakeLanguageClient;
      });

      it("should not clear diagnostics for non-flinksql documents on text change", () => {
        const fakeUri = vscode.Uri.parse("file:///fake/path/test.txt");
        const fakeDocument = {
          languageId: "plaintext",
          uri: fakeUri,
        } as vscode.TextDocument;

        // Simulate a text document change event
        const fakeEvent: vscode.TextDocumentChangeEvent = {
          document: fakeDocument,
          contentChanges: [],
          reason: vscode.TextDocumentChangeReason.Undo,
        };

        flinkManager.onDidChangeTextDocumentHandler(fakeEvent);

        // Should not have cleared diagnostics since this is not a flinksql document
        sinon.assert.notCalled(fakeDiagnosticsCollection.set);
      });

      it("should not clear diagnostics for flinksql documents on text change if no prior diagnostics", () => {
        const fakeUri = vscode.Uri.parse("file:///fake/path/test.flinksql");
        const fakeDocument = {
          languageId: FLINKSQL_LANGUAGE_ID,
          uri: fakeUri,
        } as vscode.TextDocument;

        // stash the document in the openFlinkSqlDocuments set
        flinkManager.trackDocument(fakeUri);

        // but no diagnostics set for this document
        fakeDiagnosticsCollection.get.withArgs(fakeUri).returns(undefined);

        // Simulate a text document change event
        const fakeEvent: vscode.TextDocumentChangeEvent = {
          document: fakeDocument,
          contentChanges: [],
          reason: vscode.TextDocumentChangeReason.Undo,
        };

        flinkManager.onDidChangeTextDocumentHandler(fakeEvent);

        // Should not have cleared diagnostics since this document had no prior diagnostics
        sinon.assert.notCalled(fakeDiagnosticsCollection.set);
      });

      it("should not do anything if no language client is available", () => {
        flinkManager["languageClient"] = null; // Simulate no language client
        const fakeUri = vscode.Uri.parse("file:///fake/path/test.flinksql");
        const fakeDocument = {
          languageId: FLINKSQL_LANGUAGE_ID,
          uri: fakeUri,
        } as vscode.TextDocument;
        const fakeEvent: vscode.TextDocumentChangeEvent = {
          document: fakeDocument,
          contentChanges: [],
          reason: vscode.TextDocumentChangeReason.Undo,
        };
        flinkManager.onDidChangeTextDocumentHandler(fakeEvent);
        // Should not have called diagnostics collection methods
        sinon.assert.notCalled(fakeDiagnosticsCollection.set);
        sinon.assert.notCalled(fakeDiagnosticsCollection.get);
        sinon.assert.notCalled(fakeDiagnosticsCollection.delete);
        sinon.assert.notCalled(fakeDiagnosticsCollection.has);
      });

      it("should clear diagnostics for flinksql documents on text change if had prior diagnostics and the TextDocumentChangeEvent has contentChanges", () => {
        const fakeUri = vscode.Uri.parse("file:///fake/path/test.flinksql");
        const fakeDocument = {
          languageId: FLINKSQL_LANGUAGE_ID,
          uri: fakeUri,
        } as vscode.TextDocument;

        // stash the document in the openFlinkSqlDocuments set
        flinkManager.trackDocument(fakeUri);

        // And make as if this document had diagnostics set
        fakeDiagnosticsCollection.has.withArgs(fakeUri).returns(true);

        // Simulate a text document change event
        const fakeEvent: vscode.TextDocumentChangeEvent = {
          document: fakeDocument,
          contentChanges: [
            {
              // the content here doesn't matter, we just want a TextDocumentContentChangeEvent
              range: new vscode.Range(0, 0, 1, 0),
              rangeOffset: 0,
              rangeLength: 1,
              text: "SELECT * FROM test",
            },
          ],
          reason: vscode.TextDocumentChangeReason.Undo,
        };

        flinkManager.onDidChangeTextDocumentHandler(fakeEvent);

        // Should have detected then cleared diagnostics for this document
        sinon.assert.calledTwice(fakeDiagnosticsCollection.has);
        sinon.assert.calledWith(fakeDiagnosticsCollection.has, fakeUri);

        sinon.assert.calledOnce(fakeDiagnosticsCollection.delete);
        sinon.assert.calledWith(fakeDiagnosticsCollection.delete, fakeUri);
      });

      it("should not clear diagnostics if the TextDocumentChangeEvent does not have any contentChanges", () => {
        const fakeUri = vscode.Uri.parse("file:///fake/path/test.flinksql");
        const fakeDocument = {
          languageId: FLINKSQL_LANGUAGE_ID,
          uri: fakeUri,
        } as vscode.TextDocument;

        // stash the document in the openFlinkSqlDocuments set
        flinkManager.trackDocument(fakeUri);

        // And make as if this document had diagnostics set
        fakeDiagnosticsCollection.has.withArgs(fakeUri).returns(true);

        // Simulate a text document change event
        const fakeEvent: vscode.TextDocumentChangeEvent = {
          document: fakeDocument,
          contentChanges: [], // no content changes = no clearing diagnostics
          reason: vscode.TextDocumentChangeReason.Undo,
        };

        flinkManager.onDidChangeTextDocumentHandler(fakeEvent);

        // Should check for diagnostics, but no clearing since there weren't content changes
        sinon.assert.calledOnce(fakeDiagnosticsCollection.has);
        sinon.assert.calledWith(fakeDiagnosticsCollection.has, fakeUri);

        sinon.assert.notCalled(fakeDiagnosticsCollection.delete);
      });
    });

    describe("onDidCloseTextDocumentHandler", () => {
      let untrackDocumentStub: sinon.SinonStub;

      beforeEach(() => {
        untrackDocumentStub = sandbox.stub(flinkManager, "untrackDocument");
      });

      it("should untrack flinksql documents when closed", () => {
        flinkManager.onDidCloseTextDocumentHandler(goodFlinkDocument);

        sinon.assert.calledOnce(untrackDocumentStub);
      });

      it("should not untrack on non-flinksql document close", () => {
        flinkManager.onDidCloseTextDocumentHandler(wrongLanguageIdDocument);

        sinon.assert.notCalled(untrackDocumentStub);
      });
    });

    describe("ccloudConnectedHandler", () => {
      it("should call maybeStartLanguageClient when CCloud connection is established and active editor has FlinkSQL file", () => {
        // make seem like the active editor is a flinksql document
        returnedActiveTextEditor = {
          document: goodFlinkDocument,
        } as vscode.TextEditor;

        // Simulate CCloud connection just went green event
        flinkManager.ccloudConnectedHandler(true);

        sinon.assert.calledOnce(maybeStartLanguageClientStub);
        sinon.assert.calledWith(maybeStartLanguageClientStub, goodFlinkDocument.uri);
      });

      it("should call maybeStartLanguageClient when CCloud connection is established and visible flinksql (but not the active editor)", () => {
        returnedActiveTextEditor = {
          document: wrongLanguageIdDocument,
        } as vscode.TextEditor;

        returnedVisibleTextEditors = [
          {
            document: goodFlinkDocument,
          } as vscode.TextEditor,
        ];

        // Simulate CCloud connection just went green event
        flinkManager.ccloudConnectedHandler(true);

        sinon.assert.calledOnce(maybeStartLanguageClientStub);
        sinon.assert.calledWith(maybeStartLanguageClientStub, goodFlinkDocument.uri);
      });

      it("should not call maybeStartLanguageClient when CCloud connection is established but no active flinksql editor", () => {
        // Simulate CCloud connection just went green event, but no flink sql documents open at all.
        flinkManager.ccloudConnectedHandler(true);

        sinon.assert.notCalled(maybeStartLanguageClientStub);
      });

      it("should handle ccloud disconnection gracefully", () => {
        const cleanupLanguageClientStub = sandbox.stub(
          flinkManager as any,
          "cleanupLanguageClient",
        );
        // Simulate CCloud connection just went red event
        flinkManager.ccloudConnectedHandler(false);

        // Should not call maybeStartLanguageClient on disconnection
        sinon.assert.notCalled(maybeStartLanguageClientStub);

        // but should clean up the language client
        sinon.assert.calledOnce(cleanupLanguageClientStub);
      });
    });
  });
});

/**
 * Class stubbing enough of DiagnosticsCollection methods to be useful.
 **/
class FakeDiagnosticsCollection {
  public readonly get: sinon.SinonStub;
  public readonly set: sinon.SinonStub;
  public readonly has: sinon.SinonStub;
  public readonly delete: sinon.SinonStub;

  constructor(sandbox: sinon.SinonSandbox) {
    this.get = sandbox.stub();
    this.set = sandbox.stub();
    this.has = sandbox.stub();
    this.delete = sandbox.stub();
  }
}
