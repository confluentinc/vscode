import * as assert from "assert";
import sinon from "sinon";
import { ConfigurationChangeEvent, workspace } from "vscode";
import { TEST_CCLOUD_SCHEMA_REGISTRY } from "../tests/unit/testResources";
import { getExtensionContext } from "../tests/unit/testUtils";
import { ConnectionSpec, ConnectionType, SchemaRegistryConfig } from "./clients/sidecar";
import * as contextValues from "./context/values";
import { DirectConnectionManager } from "./directConnectManager";
import { ENABLE_DIRECT_CONNECTIONS } from "./preferences/constants";
import * as connections from "./sidecar/connections";

describe("DirectConnectionManager behavior", () => {
  let sandbox: sinon.SinonSandbox;
  let onDidChangeConfigurationStub: sinon.SinonStub;
  let getConfigurationStub: sinon.SinonStub;
  let setContextValueStub: sinon.SinonStub;
  let tryToCreateConnectionStub: sinon.SinonStub;

  before(async () => {
    // DirectConnectionManager requires the extension context to be set
    await getExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    onDidChangeConfigurationStub = sandbox.stub(workspace, "onDidChangeConfiguration");
    getConfigurationStub = sandbox.stub(workspace, "getConfiguration");
    setContextValueStub = sandbox.stub(contextValues, "setContextValue");
    // don't return a Connection type since the IDs are randomly generated
    tryToCreateConnectionStub = sandbox
      .stub(connections, "tryToCreateConnection")
      .resolves({} as any);
  });

  afterEach(() => {
    // reset the singleton instance
    DirectConnectionManager["instance"] = null;
    sandbox.restore();
  });

  for (const enabled of [true, false]) {
    it(`should update the "${contextValues.ContextValues.directConnectionsEnabled}" context value when the "${ENABLE_DIRECT_CONNECTIONS}" setting is changed to ${enabled} (REMOVE ONCE EXPERIMENTAL SETTING IS NO LONGER USED)`, async () => {
      getConfigurationStub.returns({
        get: sandbox.stub().withArgs(ENABLE_DIRECT_CONNECTIONS).returns(enabled),
      });
      const mockEvent = {
        affectsConfiguration: (config: string) => config === ENABLE_DIRECT_CONNECTIONS,
      } as ConfigurationChangeEvent;
      onDidChangeConfigurationStub.yields(mockEvent);

      DirectConnectionManager.getInstance();
      // simulate the setting being changed by the user
      await onDidChangeConfigurationStub.firstCall.args[0](mockEvent);

      assert.ok(
        setContextValueStub.calledWith(
          contextValues.ContextValues.directConnectionsEnabled,
          enabled,
        ),
      );
    });
  }

  it("should not include `kafkaClusterConfig` in the ConnectionSpec if not provided", async () => {
    const connectionName = "Test Connection";
    const kafkaClusterConfig = undefined;
    const schemaRegistryConfig: SchemaRegistryConfig = { uri: TEST_CCLOUD_SCHEMA_REGISTRY.uri };

    const manager = DirectConnectionManager.getInstance();
    const result = await manager.createConnection(
      kafkaClusterConfig,
      schemaRegistryConfig,
      connectionName,
    );

    assert.ok(tryToCreateConnectionStub.calledOnce);
    const spec: ConnectionSpec = tryToCreateConnectionStub.firstCall.args[0];
    // don't test the entire ConnectionSpec since `id` is randomly generated
    assert.strictEqual(spec.kafka_cluster, kafkaClusterConfig);
    assert.deepStrictEqual(spec.schema_registry, schemaRegistryConfig);
    assert.equal(spec.name, connectionName);
    assert.equal(spec.type, ConnectionType.Direct);
    assert.ok(result.success);
  });

  it("should not include `schemaRegistryConfig` in the ConnectionSpec if not provided", async () => {
    const connectionName = "Test Connection";
    const kafkaClusterConfig = { bootstrap_servers: "localhost:9092" };
    const schemaRegistryConfig = undefined;

    const manager = DirectConnectionManager.getInstance();
    const result = await manager.createConnection(
      kafkaClusterConfig,
      schemaRegistryConfig,
      connectionName,
    );

    assert.ok(tryToCreateConnectionStub.calledOnce);
    const spec: ConnectionSpec = tryToCreateConnectionStub.firstCall.args[0];
    // don't test the entire ConnectionSpec since `id` is randomly generated
    assert.deepStrictEqual(spec.kafka_cluster, kafkaClusterConfig);
    assert.strictEqual(spec.schema_registry, schemaRegistryConfig);
    assert.equal(spec.name, connectionName);
    assert.equal(spec.type, ConnectionType.Direct);
    assert.ok(result.success);
  });
});
