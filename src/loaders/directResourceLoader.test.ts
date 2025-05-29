import assert from "assert";
import * as sinon from "sinon";

import {
  TEST_DIRECT_ENVIRONMENT,
  TEST_DIRECT_ENVIRONMENT_ID,
  TEST_DIRECT_KAFKA_CLUSTER,
  TEST_DIRECT_SCHEMA_REGISTRY,
} from "../../tests/unit/testResources";
import { TEST_DIRECT_CONNECTION_ID } from "../../tests/unit/testResources/connection";
import * as directGraphQl from "../graphql/direct";
import { DirectEnvironment } from "../models/environment";
import { EnvironmentId } from "../models/resource";
import { DirectResourceLoader } from "./directResourceLoader";

describe("DirectResourceLoader", () => {
  let myEnvironment: DirectEnvironment;

  let sandbox: sinon.SinonSandbox;
  let loader: DirectResourceLoader;
  let getDirectResourcesStub: sinon.SinonStub;

  beforeEach(() => {
    loader = new DirectResourceLoader(TEST_DIRECT_CONNECTION_ID);

    sandbox = sinon.createSandbox();

    // Use the test fixture with Kafka cluster and Schema Registry configured
    myEnvironment = new DirectEnvironment({
      ...TEST_DIRECT_ENVIRONMENT,
      kafkaClusters: [TEST_DIRECT_KAFKA_CLUSTER],
      kafkaConfigured: true,
      schemaRegistry: TEST_DIRECT_SCHEMA_REGISTRY,
      schemaRegistryConfigured: false,
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
        TEST_DIRECT_ENVIRONMENT_ID,
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
        TEST_DIRECT_ENVIRONMENT_ID,
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
