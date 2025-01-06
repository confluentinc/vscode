import * as assert from "assert";
import * as sinon from "sinon";
import {
  TEST_LOCAL_KAFKA_CLUSTER,
  TEST_LOCAL_SCHEMA_REGISTRY,
} from "../../../tests/unit/testResources";
import { TEST_DIRECT_CONNECTION_FORM_SPEC } from "../../../tests/unit/testResources/connection";
import { getTestExtensionContext } from "../../../tests/unit/testUtils";
import { ConnectionId } from "../../models/resource";
import { FormConnectionType } from "../../webview/direct-connect-form";
import {
  CustomConnectionSpec,
  DirectConnectionsById,
  getResourceManager,
  ResourceManager,
} from "../resourceManager";
import { MigrationV2 } from "./v2";

describe("MigrationV2", () => {
  let sandbox: sinon.SinonSandbox;
  let rm: ResourceManager;
  let getDirectConnectionsStub: sinon.SinonStub;
  let addDirectConnectionStub: sinon.SinonStub;

  let migration: MigrationV2;

  before(async () => {
    await getTestExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    // only stub the methods we need to test so we aren't interfering with SecretStorage; just test
    // the call arguments for `addDirectConnection` based on returned `getDirectConnections` values
    rm = getResourceManager();
    getDirectConnectionsStub = sandbox.stub(rm, "getDirectConnections");
    addDirectConnectionStub = sandbox.stub(rm, "addDirectConnection");

    migration = new MigrationV2();
  });

  afterEach(() => {
    sandbox.restore();
  });

  type ConnectionTypeSSLEnabled = [FormConnectionType, boolean];
  const testConfigs: ConnectionTypeSSLEnabled[] = [
    ["Confluent Cloud", true],
    ["Other", false],
  ];

  for (const [formConnectionType, expectedSsl] of testConfigs) {
    it(`upgradeSecretStorage() should set ssl.enabled=${expectedSsl} for form connection type "${formConnectionType}"`, async () => {
      // if v1 test connections are returned, they should be updated to v2
      const testSpecs: CustomConnectionSpec[] = [
        {
          ...TEST_DIRECT_CONNECTION_FORM_SPEC,
          kafka_cluster: {
            bootstrap_servers: TEST_LOCAL_KAFKA_CLUSTER.bootstrapServers,
            ssl: undefined,
          },
          schema_registry: { uri: TEST_LOCAL_SCHEMA_REGISTRY.uri, ssl: undefined },
          formConnectionType,
        },
      ];
      console.info("***TEST SPECS***", testSpecs[0]);
      const testV1Map: DirectConnectionsById = new Map(
        testSpecs.map((spec): [ConnectionId, CustomConnectionSpec] => [spec.id, spec]),
      );
      getDirectConnectionsStub.resolves(testV1Map);

      await migration.upgradeSecretStorage();

      // addDirectConnection should be called once per migrated spec
      assert.strictEqual(addDirectConnectionStub.callCount, 1);
      const addDirectConnectionCallArgs: CustomConnectionSpec = addDirectConnectionStub.args[0][0];
      assert.strictEqual(addDirectConnectionCallArgs.kafka_cluster!.ssl!.enabled, expectedSsl);
      assert.strictEqual(addDirectConnectionCallArgs.schema_registry!.ssl!.enabled, expectedSsl);
    });

    it(`upgradeSecretStorage() should not update specs with 'ssl' already set (formConnectionType=${formConnectionType})`, async () => {
      const testSpecs: CustomConnectionSpec[] = [
        {
          ...TEST_DIRECT_CONNECTION_FORM_SPEC,
          kafka_cluster: {
            bootstrap_servers: TEST_LOCAL_KAFKA_CLUSTER.bootstrapServers,
            ssl: { enabled: expectedSsl },
          },
          schema_registry: {
            uri: TEST_LOCAL_SCHEMA_REGISTRY.uri,
            ssl: { enabled: expectedSsl },
          },
          formConnectionType,
        },
      ];
      const testV1Map: DirectConnectionsById = new Map(
        testSpecs.map((spec): [ConnectionId, CustomConnectionSpec] => [spec.id, spec]),
      );
      getDirectConnectionsStub.resolves(testV1Map);

      await migration.upgradeSecretStorage();

      assert.ok(addDirectConnectionStub.notCalled);
    });
  }

  it("upgradeSecretStorage() should handle empty connection spec map", async () => {
    getDirectConnectionsStub.resolves(new Map());

    await migration.upgradeSecretStorage();

    assert.ok(addDirectConnectionStub.notCalled);
  });

  it("downgradeSecretStorage() should remove 'ssl' configs from connection specs", async () => {
    const testSpecs: CustomConnectionSpec[] = [
      {
        ...TEST_DIRECT_CONNECTION_FORM_SPEC,
        kafka_cluster: {
          bootstrap_servers: TEST_LOCAL_KAFKA_CLUSTER.bootstrapServers,
          ssl: { enabled: true },
        },
        schema_registry: {
          uri: TEST_LOCAL_SCHEMA_REGISTRY.uri,
          ssl: { enabled: true },
        },
      },
    ];
    const testV2Map: DirectConnectionsById = new Map(
      testSpecs.map((spec): [ConnectionId, CustomConnectionSpec] => [spec.id, spec]),
    );
    getDirectConnectionsStub.resolves(testV2Map);

    await migration.downgradeSecretStorage();

    // addDirectConnection should be called once per migrated spec
    assert.strictEqual(addDirectConnectionStub.callCount, 1);
    const addDirectConnectionCallArgs: CustomConnectionSpec = addDirectConnectionStub.args[0][0];
    assert.strictEqual(addDirectConnectionCallArgs.kafka_cluster!.ssl, undefined);
    assert.strictEqual(addDirectConnectionCallArgs.schema_registry!.ssl, undefined);
  });

  it("downgradeSecretStorage() should not update specs that don't have 'ssl' configs set", async () => {
    const testSpecs: CustomConnectionSpec[] = [
      {
        ...TEST_DIRECT_CONNECTION_FORM_SPEC,
        kafka_cluster: {
          bootstrap_servers: TEST_LOCAL_KAFKA_CLUSTER.bootstrapServers,
          ssl: undefined,
        },
        schema_registry: {
          uri: TEST_LOCAL_SCHEMA_REGISTRY.uri,
          ssl: undefined,
        },
      },
    ];
    const testV2Map: DirectConnectionsById = new Map(
      testSpecs.map((spec): [ConnectionId, CustomConnectionSpec] => [spec.id, spec]),
    );
    getDirectConnectionsStub.resolves(testV2Map);

    await migration.downgradeSecretStorage();

    assert.ok(addDirectConnectionStub.notCalled);
  });

  it("downgradeSecretStorage() should handle empty connection spec map", async () => {
    getDirectConnectionsStub.resolves(new Map());

    await migration.downgradeSecretStorage();

    assert.ok(addDirectConnectionStub.notCalled);
  });
});
