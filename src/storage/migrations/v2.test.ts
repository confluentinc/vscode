import * as assert from "assert";
import * as sinon from "sinon";
import { ExtensionContext } from "vscode";
import {
  TEST_LOCAL_KAFKA_CLUSTER,
  TEST_LOCAL_SCHEMA_REGISTRY,
} from "../../../tests/unit/testResources";
import { TEST_DIRECT_CONNECTION_FORM_SPEC } from "../../../tests/unit/testResources/connection";
import { getTestExtensionContext } from "../../../tests/unit/testUtils";
import { ConnectionId } from "../../models/resource";
import { FormConnectionType } from "../../webview/direct-connect-form";
import { CustomConnectionSpec, DirectConnectionsById, mapToString } from "../resourceManager";
import { MigrationV2 } from "./v2";

describe("storage/migrations/v2", () => {
  let sandbox: sinon.SinonSandbox;
  let secretsGetStub: sinon.SinonStub;
  let secretsStoreStub: sinon.SinonStub;
  let context: ExtensionContext;
  let migration: MigrationV2;

  before(async () => {
    context = await getTestExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    // only stub the methods we need to test so we aren't interfering with SecretStorage; just test
    // the call arguments for `store()` based on returned `get()` values
    secretsGetStub = sandbox.stub(context.secrets, "get");
    secretsStoreStub = sandbox.stub(context.secrets, "store");

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
      const testV1Map: DirectConnectionsById = new Map(
        testSpecs.map((spec): [ConnectionId, CustomConnectionSpec] => [spec.id, spec]),
      );
      secretsGetStub.resolves(mapToString(testV1Map));

      await migration.upgradeSecretStorage();

      // secrets.store() should be called once during an upgrade
      assert.strictEqual(secretsStoreStub.callCount, 1);
      // and now we have to pull out the stringified Map that was used for the call
      const mapStringArg = JSON.parse(secretsStoreStub.args[0][1]);
      const secretsStoreCallArgs: any = Object.values(mapStringArg)[0];
      assert.strictEqual(secretsStoreCallArgs.kafka_cluster!.ssl!.enabled, expectedSsl);
      assert.strictEqual(secretsStoreCallArgs.schema_registry!.ssl!.enabled, expectedSsl);
    });

    it(`upgradeSecretStorage() should not change specs with 'ssl' already set (formConnectionType=${formConnectionType})`, async () => {
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
      secretsGetStub.resolves(mapToString(testV1Map));

      await migration.upgradeSecretStorage();

      // still going to write to SecretStorage, but the data should be unchanged
      assert.strictEqual(secretsStoreStub.callCount, 1);
      // and now we have to pull out the stringified Map that was used for the call
      const mapStringArg = JSON.parse(secretsStoreStub.args[0][1]);
      const secretsStoreCallArgs: any = Object.values(mapStringArg)[0];
      assert.strictEqual(secretsStoreCallArgs.kafka_cluster!.ssl!.enabled, expectedSsl);
      assert.strictEqual(
        secretsStoreCallArgs.kafka_cluster!.ssl!.enabled,
        testSpecs[0].kafka_cluster!.ssl!.enabled,
      );
      assert.strictEqual(secretsStoreCallArgs.schema_registry!.ssl!.enabled, expectedSsl);
      assert.strictEqual(
        secretsStoreCallArgs.schema_registry!.ssl!.enabled,
        testSpecs[0].schema_registry!.ssl!.enabled,
      );
    });
  }

  it("upgradeSecretStorage() should handle empty connection spec map", async () => {
    // we could just use "{}" but my trust is shaken
    secretsGetStub.resolves(mapToString(new Map()));

    await migration.upgradeSecretStorage();

    assert.ok(secretsStoreStub.notCalled);
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
    secretsGetStub.resolves(mapToString(testV2Map));

    await migration.downgradeSecretStorage();

    // secrets.store() should be called once during a downgrade
    assert.strictEqual(secretsStoreStub.callCount, 1);
    // and now we have to pull out the stringified Map that was used for the call
    const mapStringArg = JSON.parse(secretsStoreStub.args[0][1]);
    const secretsStoreCallArgs: any = Object.values(mapStringArg)[0];
    assert.strictEqual(secretsStoreCallArgs.kafka_cluster!.ssl, undefined);
    assert.strictEqual(secretsStoreCallArgs.schema_registry!.ssl, undefined);
  });

  it("downgradeSecretStorage() should not change specs that don't have 'ssl' configs set", async () => {
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
    secretsGetStub.resolves(mapToString(testV2Map));

    await migration.downgradeSecretStorage();

    // secrets.store() should be called once during a downgrade
    assert.ok(secretsStoreStub.calledOnce);
    // and now we have to pull out the stringified Map that was used for the call
    const mapStringArg = JSON.parse(secretsStoreStub.args[0][1]);
    const secretsStoreCallArgs: any = Object.values(mapStringArg)[0];
    assert.strictEqual(secretsStoreCallArgs.kafka_cluster!.ssl, undefined);
    assert.strictEqual(secretsStoreCallArgs.kafka_cluster!.ssl, testSpecs[0].kafka_cluster!.ssl);
    assert.strictEqual(secretsStoreCallArgs.schema_registry!.ssl, undefined);
    assert.strictEqual(
      secretsStoreCallArgs.schema_registry!.ssl,
      testSpecs[0].schema_registry!.ssl,
    );
  });

  it("downgradeSecretStorage() should handle empty connection spec map", async () => {
    // we could just use "{}" but my trust is shaken
    secretsGetStub.resolves(mapToString(new Map()));

    await migration.downgradeSecretStorage();

    assert.ok(secretsStoreStub.notCalled);
  });
});
