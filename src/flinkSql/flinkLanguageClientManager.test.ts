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
    it("should return false when computePoolId is missing", async () => {
      // no default Flink settings set
      stubbedConfigs.stubGet(FLINK_CONFIG_COMPUTE_POOL, "").stubGet(FLINK_CONFIG_DATABASE, "");

      const result = await flinkManager.validateFlinkSettings(null);
      assert.strictEqual(result, false);
    });

    it("should return false when compute pool is invalid", async () => {
      // invalid default compute pool
      stubbedConfigs
        .stubGet(FLINK_CONFIG_COMPUTE_POOL, "invalid-pool-id")
        .stubGet(FLINK_CONFIG_DATABASE, "");

      const result = await flinkManager.validateFlinkSettings("invalid-pool-id");
      assert.strictEqual(result, false);
    });

    it("should return true when compute pool is valid", async () => {
      // valid default compute pool
      stubbedConfigs
        .stubGet(FLINK_CONFIG_COMPUTE_POOL, TEST_CCLOUD_FLINK_COMPUTE_POOL_ID)
        .stubGet(FLINK_CONFIG_DATABASE, "");

      const result = await flinkManager.validateFlinkSettings(TEST_CCLOUD_FLINK_COMPUTE_POOL_ID);
      assert.strictEqual(result, true);
    });

    it("should check resources availability when compute pool is set", async () => {
      // valid default Flink settings
      stubbedConfigs.stubGet(FLINK_CONFIG_COMPUTE_POOL, TEST_CCLOUD_FLINK_COMPUTE_POOL_ID);

      const result = await flinkManager.validateFlinkSettings(TEST_CCLOUD_FLINK_COMPUTE_POOL_ID);
      assert.strictEqual(result, true);
    });
  });

  describe("getFlinkSqlSettings", () => {
    const testUri = vscode.Uri.parse("file:///test.flink.sql");

    it("should return null for all settings if not configured", async () => {
      stubbedConfigs.stubGet(FLINK_CONFIG_COMPUTE_POOL, "").stubGet(FLINK_CONFIG_DATABASE, "");
      resourceManagerStub.getUriMetadata.resolves(undefined);

      const settings = await flinkManager.getFlinkSqlSettings(testUri);

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

      const settings = await flinkManager.getFlinkSqlSettings(testUri);

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

      const settings = await flinkManager.getFlinkSqlSettings(testUri);

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

      const settings = await flinkManager.getFlinkSqlSettings(testUri);

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

      beforeEach(() => {
        notifyConfigChangedStub = sandbox.stub(flinkManager as any, "notifyConfigChanged");
        openTextDocumentStub = sandbox.stub(vscode.workspace, "openTextDocument");
      });

      it("Should call notifyConfigChanged if current document matches metadata", async () => {
        const uriString = "file:///fake/path/test.flinksql";
        const fakeUri = vscode.Uri.parse(uriString);
        flinkManager["lastDocUri"] = fakeUri;

        // Make an equivalent Uri but separate instance.
        const equivMetadataUri = vscode.Uri.parse(uriString);

        await flinkManager.uriMetadataSetHandler(equivMetadataUri);

        sinon.assert.calledOnce(notifyConfigChangedStub);
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
      let fakeDiagnosticsCollection: { get: sinon.SinonStub; set: sinon.SinonStub };
      beforeEach(() => {
        // wire a mock LanguageClient to the flinkManager
        const fakeLanguageClient = sandbox.createStubInstance(LanguageClient);

        fakeDiagnosticsCollection = {
          get: sandbox.stub(),
          set: sandbox.stub(),
        };

        // Override the read-only diagnostics property for testing
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
      });

      it("should clear diagnostics for flinksql documents on text change if had prior diagnostics", () => {
        const fakeUri = vscode.Uri.parse("file:///fake/path/test.flinksql");
        const fakeDocument = {
          languageId: FLINKSQL_LANGUAGE_ID,
          uri: fakeUri,
        } as vscode.TextDocument;

        // stash the document in the openFlinkSqlDocuments set
        flinkManager.trackDocument(fakeUri);

        // And make as if this document had diagnostics set
        fakeDiagnosticsCollection.get.withArgs(fakeUri).returns(true);

        // Simulate a text document change event
        const fakeEvent: vscode.TextDocumentChangeEvent = {
          document: fakeDocument,
          contentChanges: [],
          reason: vscode.TextDocumentChangeReason.Undo,
        };

        flinkManager.onDidChangeTextDocumentHandler(fakeEvent);

        // Should have cleared diagnostics for this document
        sinon.assert.calledOnce(fakeDiagnosticsCollection.set);
        sinon.assert.calledWith(fakeDiagnosticsCollection.set, fakeUri, []);
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
