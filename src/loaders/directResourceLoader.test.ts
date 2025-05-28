import assert from "assert";
import * as sinon from "sinon";

import { ConnectionType } from "../clients/sidecar";
import * as directGraphQl from "../graphql/direct";
import { DirectEnvironment } from "../models/environment";
import { DirectKafkaCluster } from "../models/kafkaCluster";
import { ConnectionId, EnvironmentId } from "../models/resource";
import { DirectSchemaRegistry } from "../models/schemaRegistry";
import { DirectResourceLoader } from "./directResourceLoader";

describe("DirectResourceLoader", () => {
  const connectionId = "test-connection-id";

  let myEnvironment: DirectEnvironment;

  let sandbox: sinon.SinonSandbox;
  let loader: DirectResourceLoader;
  let getDirectResourcesStub: sinon.SinonStub;

  beforeEach(() => {
    loader = new DirectResourceLoader(connectionId as ConnectionId);

    sandbox = sinon.createSandbox();

    // The DirectEnvironment for the connectionId we're testing, initially configured
    // with a Kafka cluster and no Schema Registry.
    myEnvironment = new DirectEnvironment({
      id: connectionId as EnvironmentId,
      connectionId: connectionId as ConnectionId,
      name: "Environment 1",
      kafkaConfigured: true,
      kafkaClusters: [
        DirectKafkaCluster.create({
          id: "kafka-cluster-1",
          name: "Kafka Cluster 1",
          bootstrapServers: "kafka1.example.com:9092",
          uri: "kafka://kafka1.example.com:9092",
          connectionId: connectionId as ConnectionId,
          connectionType: ConnectionType.Direct,
        }),
      ],
      schemaRegistryConfigured: false,
      schemaRegistry: DirectSchemaRegistry.create({
        connectionId: connectionId as ConnectionId,
        connectionType: ConnectionType.Direct,
        id: "schema-registry-1",
        uri: "http://schema-registry1.example.com:8081",
        environmentId: connectionId as EnvironmentId,
      }),
    });

    // stub getDirectResources() to return our test environment.
    getDirectResourcesStub = sandbox
      .stub(directGraphQl, "getDirectResources")
      .resolves(myEnvironment);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("getEnvironments()", () => {
    it("Deep fetches once and caches the result", async () => {
      const environments = await loader.getEnvironments();
      sinon.assert.calledOnce(getDirectResourcesStub);
      assert.deepStrictEqual(environments, [myEnvironment]);

      // Call again, should not call the stub again.
      const cachedEnvironments = await loader.getEnvironments();
      sinon.assert.calledOnce(getDirectResourcesStub);
      assert.deepStrictEqual(cachedEnvironments, [myEnvironment]);

      // Call with forceDeepRefresh, should call the stub again.
      const refreshedEnvironments = await loader.getEnvironments(true);
      sinon.assert.calledTwice(getDirectResourcesStub);
      assert.deepStrictEqual(refreshedEnvironments, [myEnvironment]);
    });
  });

  describe("purgeCache()", () => {
    it("Clears the cached environments", async () => {
      await loader.getEnvironments(); // Load and cache first.
      sinon.assert.calledOnce(getDirectResourcesStub);
      loader.purgeCache(); // Clear the cache.
      await loader.getEnvironments(); // Should call the stub again.
      sinon.assert.calledTwice(getDirectResourcesStub); // Should have called the stub again.
    });
  });

  describe("getKafkaClustersForEnvironmentId()", () => {
    it("Returns Kafka clusters for the specified environment ID", async () => {
      const kafkaClusters = await loader.getKafkaClustersForEnvironmentId(
        connectionId as EnvironmentId,
      );
      assert.deepStrictEqual(kafkaClusters, myEnvironment.kafkaClusters);
    });

    it("Throws an error for unknown environment ID", async () => {
      await assert.rejects(
        loader.getKafkaClustersForEnvironmentId("unknown-environment-id"),
        /Unknown environmentId unknown-environment-id/,
      );
    });
  });

  describe("getSchemaRegistries()", () => {
    it("Returns the expected schema registry", async () => {
      const schemaRegistries = await loader.getSchemaRegistries();
      assert.deepStrictEqual(schemaRegistries, [myEnvironment.schemaRegistry]);
    });

    it("Returns an empty array if no schema registries are configured", async () => {
      // Modify the environment to not have a schema registry.
      myEnvironment.schemaRegistry = undefined;
      const schemaRegistries = await loader.getSchemaRegistries();
      assert.deepStrictEqual(schemaRegistries, []);
    });
  });

  describe("getSchemaRegistryForEnvironmentId()", () => {
    it("Returns the schema registry for the specified environment ID", async () => {
      const schemaRegistry = await loader.getSchemaRegistryForEnvironmentId(
        connectionId as EnvironmentId,
      );
      assert.deepStrictEqual(schemaRegistry, myEnvironment.schemaRegistry);
    });

    it("Returns undefined for an environment without a schema registry", async () => {
      const schemaRegistry = await loader.getSchemaRegistryForEnvironmentId(
        "another-environment-id" as EnvironmentId,
      );
      assert.strictEqual(schemaRegistry, undefined);
    });
  });
});
