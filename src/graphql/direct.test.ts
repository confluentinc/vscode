import * as assert from "assert";
import * as sinon from "sinon";
import { getSidecarStub } from "../../tests/stubs/sidecar";
import {
  TEST_DIRECT_KAFKA_CLUSTER,
  TEST_DIRECT_SCHEMA_REGISTRY,
} from "../../tests/unit/testResources";
import {
  TEST_DIRECT_CONNECTION,
  TEST_DIRECT_CONNECTION_FORM_SPEC,
  TEST_DIRECT_CONNECTION_ID,
} from "../../tests/unit/testResources/connection";
import { ConnectionType } from "../clients/sidecar";
import * as errorModule from "../errors";
import { DirectEnvironment } from "../models/environment";
import { DirectKafkaCluster } from "../models/kafkaCluster";
import { DirectSchemaRegistry } from "../models/schemaRegistry";
import * as notifications from "../notifications";
import { SidecarHandle } from "../sidecar";
import { CustomConnectionSpec, ResourceManager } from "../storage/resourceManager";
import { getDirectResources } from "./direct";

/**
 * GraphQL query result which includes:
 * - {@link TEST_DIRECT_CONNECTION} properties
 * - {@link TEST_DIRECT_KAFKA_CLUSTER} properties
 * - {@link TEST_DIRECT_SCHEMA_REGISTRY} properties
 */
const fakeDirectConnectionByIdResult = {
  directConnectionById: {
    id: TEST_DIRECT_CONNECTION_ID,
    name: TEST_DIRECT_CONNECTION.spec.name,
    type: ConnectionType.Direct,
    kafkaCluster: {
      id: TEST_DIRECT_KAFKA_CLUSTER.id,
      bootstrapServers: TEST_DIRECT_KAFKA_CLUSTER.bootstrapServers,
      uri: TEST_DIRECT_KAFKA_CLUSTER.uri,
    },
    schemaRegistry: {
      id: TEST_DIRECT_SCHEMA_REGISTRY.id,
      uri: TEST_DIRECT_SCHEMA_REGISTRY.uri,
    },
  },
};

describe("graphql/direct.ts getDirectResources()", () => {
  let sandbox: sinon.SinonSandbox;

  let sidecarStub: sinon.SinonStubbedInstance<SidecarHandle>;
  let logErrorStub: sinon.SinonStub;
  let showErrorNotificationStub: sinon.SinonStub;
  let stubbedResourceManager: sinon.SinonStubbedInstance<ResourceManager>;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // create the stub for the sidecar (which will automatically stub the .query method)
    sidecarStub = getSidecarStub(sandbox);

    // for stubbing the stored (test) direct connection spec
    stubbedResourceManager = sandbox.createStubInstance(ResourceManager);
    stubbedResourceManager.getDirectConnection.resolves({
      ...TEST_DIRECT_CONNECTION_FORM_SPEC,
      // set Kafka/SR configs by default
      kafka_cluster: {
        bootstrap_servers: TEST_DIRECT_KAFKA_CLUSTER.bootstrapServers,
      },
      schema_registry: {
        uri: TEST_DIRECT_SCHEMA_REGISTRY.uri,
      },
    } satisfies CustomConnectionSpec);
    sandbox.stub(ResourceManager, "getInstance").returns(stubbedResourceManager);

    // helper stubs
    logErrorStub = sandbox.stub(errorModule, "logError");
    showErrorNotificationStub = sandbox.stub(notifications, "showErrorNotificationWithButtons");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should return a DirectEnvironment with a Kafka cluster and a Schema Registry when both are returned", async () => {
    sidecarStub.query.resolves(fakeDirectConnectionByIdResult);

    const result: DirectEnvironment | undefined =
      await getDirectResources(TEST_DIRECT_CONNECTION_ID);

    assert.ok(result);
    assert.strictEqual(result.name, TEST_DIRECT_CONNECTION.spec.name);
    assert.strictEqual(result.kafkaClusters.length, 1);
    assert.ok(result.schemaRegistry);
    sinon.assert.calledOnce(sidecarStub.query);
    sinon.assert.calledOnceWithExactly(
      stubbedResourceManager.getDirectConnection,
      TEST_DIRECT_CONNECTION_ID,
    );
  });

  it("should properly map GraphQL response values to DirectEnvironment child resources", async () => {
    sidecarStub.query.resolves(fakeDirectConnectionByIdResult);

    const result: DirectEnvironment | undefined =
      await getDirectResources(TEST_DIRECT_CONNECTION_ID);

    assert.ok(result);
    // check the DirectKafkaCluster properties
    const kafkaCluster: DirectKafkaCluster = result.kafkaClusters[0];
    assert.ok(kafkaCluster);
    assert.strictEqual(kafkaCluster.id, TEST_DIRECT_KAFKA_CLUSTER.id);
    assert.strictEqual(kafkaCluster.bootstrapServers, TEST_DIRECT_KAFKA_CLUSTER.bootstrapServers);
    assert.strictEqual(kafkaCluster.uri, TEST_DIRECT_KAFKA_CLUSTER.uri);
    assert.strictEqual(kafkaCluster.connectionId, TEST_DIRECT_CONNECTION_ID);
    assert.strictEqual(kafkaCluster.connectionType, ConnectionType.Direct);

    // check the DirectSchemaRegistry properties
    const schemaRegistry: DirectSchemaRegistry | undefined = result.schemaRegistry;
    assert.ok(schemaRegistry);
    assert.strictEqual(schemaRegistry.id, TEST_DIRECT_SCHEMA_REGISTRY.id);
    assert.strictEqual(schemaRegistry.uri, TEST_DIRECT_SCHEMA_REGISTRY.uri);
    assert.strictEqual(schemaRegistry.connectionId, TEST_DIRECT_CONNECTION_ID);
    assert.strictEqual(schemaRegistry.connectionType, ConnectionType.Direct);
  });

  it("should return a DirectEnvironment with only a Kafka cluster when a Schema Registry is not returned", async () => {
    sidecarStub.query.resolves({
      directConnectionById: {
        ...fakeDirectConnectionByIdResult.directConnectionById,
        schemaRegistry: null,
      },
    });

    const result: DirectEnvironment | undefined =
      await getDirectResources(TEST_DIRECT_CONNECTION_ID);

    assert.ok(result);
    assert.strictEqual(result.kafkaClusters.length, 1);
    // even if SR is configured in the connection spec, it may not be returned due to connection issues
    assert.strictEqual(result.schemaRegistry, undefined);
    sinon.assert.calledOnce(sidecarStub.query);
    sinon.assert.calledOnceWithExactly(
      stubbedResourceManager.getDirectConnection,
      TEST_DIRECT_CONNECTION_ID,
    );
  });

  it("should return a DirectEnvironment with only a Schema Registry when a Kafka cluster is not returned", async () => {
    sidecarStub.query.resolves({
      directConnectionById: {
        ...fakeDirectConnectionByIdResult.directConnectionById,
        kafkaCluster: null,
      },
    });

    const result: DirectEnvironment | undefined =
      await getDirectResources(TEST_DIRECT_CONNECTION_ID);

    assert.ok(result);
    // even if Kafka is configured in the connection spec, it may not be returned due to connection issues
    assert.strictEqual(result.kafkaClusters.length, 0);
    assert.ok(result.schemaRegistry);
    sinon.assert.calledOnce(sidecarStub.query);
    sinon.assert.calledOnceWithExactly(
      stubbedResourceManager.getDirectConnection,
      TEST_DIRECT_CONNECTION_ID,
    );
  });

  it("should handle errors when the GraphQL query fails", async () => {
    const error = new Error("Test error");
    sidecarStub.query.rejects(error);

    const result: DirectEnvironment | undefined =
      await getDirectResources(TEST_DIRECT_CONNECTION_ID);

    assert.strictEqual(result, undefined);
    sinon.assert.calledOnce(logErrorStub);
    sinon.assert.calledWith(logErrorStub, error, "direct connection resources", {
      extra: { functionName: "getDirectResources" },
    });
    sinon.assert.calledOnce(showErrorNotificationStub);
    sinon.assert.calledWith(
      showErrorNotificationStub,
      `Failed to fetch resources for direct Kafka / Schema Registry connection(s): ${error}`,
    );
    sinon.assert.notCalled(stubbedResourceManager.getDirectConnection);
  });

  it("should return undefined when directConnectionById returns null", async () => {
    // bogus connection ID? we shouldn't typically see this
    sidecarStub.query.resolves({
      directConnectionById: null,
    });

    const result: DirectEnvironment | undefined =
      await getDirectResources(TEST_DIRECT_CONNECTION_ID);

    assert.strictEqual(result, undefined);
    sinon.assert.calledOnce(sidecarStub.query);
    sinon.assert.notCalled(stubbedResourceManager.getDirectConnection);
  });

  it("should pass connection spec and form info to the DirectEnvironment", async () => {
    sidecarStub.query.resolves(fakeDirectConnectionByIdResult);

    const result: DirectEnvironment | undefined =
      await getDirectResources(TEST_DIRECT_CONNECTION_ID);

    assert.ok(result);
    assert.strictEqual(result.kafkaConfigured, true);
    assert.strictEqual(result.schemaRegistryConfigured, true);
    assert.strictEqual(
      result.formConnectionType,
      TEST_DIRECT_CONNECTION_FORM_SPEC.formConnectionType,
    );
  });
});
