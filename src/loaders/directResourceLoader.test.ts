import assert from "assert";
import * as sinon from "sinon";

import {
  TEST_DIRECT_ENVIRONMENT,
  TEST_DIRECT_ENVIRONMENT_ID,
  TEST_DIRECT_KAFKA_CLUSTER,
  TEST_DIRECT_SCHEMA_REGISTRY,
} from "../../tests/unit/testResources";
import {
  TEST_DIRECT_CONNECTION_FORM_SPEC,
  TEST_DIRECT_CONNECTION_ID,
} from "../../tests/unit/testResources/connection";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import { DirectEnvironment } from "../models/environment";
import type { EnvironmentId } from "../models/resource";
import * as resourceManagerModule from "../storage/resourceManager";
import type { CustomConnectionSpec } from "../storage/resourceManager";
import { DirectResourceLoader } from "./directResourceLoader";

describe("DirectResourceLoader", () => {
  let myEnvironment: DirectEnvironment;
  let connectionSpec: CustomConnectionSpec;

  let sandbox: sinon.SinonSandbox;
  let loader: DirectResourceLoader;
  let getDirectConnectionStub: sinon.SinonStub;

  before(async () => {
    await getTestExtensionContext();
  });

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    // Use the test fixture with Kafka cluster and Schema Registry configured
    myEnvironment = new DirectEnvironment({
      ...TEST_DIRECT_ENVIRONMENT,
      kafkaClusters: [TEST_DIRECT_KAFKA_CLUSTER],
      kafkaConfigured: true,
      schemaRegistry: TEST_DIRECT_SCHEMA_REGISTRY,
      schemaRegistryConfigured: false,
    });

    // Create a connection spec that matches our test environment
    connectionSpec = {
      ...TEST_DIRECT_CONNECTION_FORM_SPEC,
      kafkaCluster: {
        bootstrapServers: TEST_DIRECT_KAFKA_CLUSTER.bootstrapServers,
      },
      schemaRegistry: {
        uri: TEST_DIRECT_SCHEMA_REGISTRY.uri,
      },
    };

    // Stub getResourceManager to return a mock with getDirectConnection
    const mockResourceManager = resourceManagerModule.getResourceManager();
    getDirectConnectionStub = sandbox
      .stub(mockResourceManager, "getDirectConnection")
      .resolves(connectionSpec);

    // Create loader after stubbing
    loader = new DirectResourceLoader(TEST_DIRECT_CONNECTION_ID);

    // Ensure workspace storage cached data for this connection id is cleared before each test.
    await loader.reset();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("getEnvironments()", () => {
    it("Deep fetches once and caches the result", async () => {
      const environments = await loader.getEnvironments();
      sinon.assert.calledOnce(getDirectConnectionStub);
      assert.strictEqual(environments.length, 1, "first fetch should return one environment");

      // Call again, should not call the stub again.
      const cachedEnvironments = await loader.getEnvironments();
      sinon.assert.calledOnce(getDirectConnectionStub);
      assert.strictEqual(
        cachedEnvironments.length,
        1,
        "second fetch should return cached environment",
      );

      // Call with forceDeepRefresh, should call the stub again.
      const refreshedEnvironments = await loader.getEnvironments(true);
      sinon.assert.calledTwice(getDirectConnectionStub);
      assert.strictEqual(
        refreshedEnvironments.length,
        1,
        "third fetch should return refreshed environment",
      );
    });

    it("should not cache when getDirectConnection returns null and retry on next call", async () => {
      // Stub getDirectConnection to return null (simulating no connection found)
      getDirectConnectionStub.resolves(null);

      const environments = await loader.getEnvironments();
      sinon.assert.calledOnce(getDirectConnectionStub);
      assert.deepStrictEqual(environments, []);

      // Call again, should call the stub again since nothing was cached
      const secondCallEnvironments = await loader.getEnvironments();
      sinon.assert.calledTwice(getDirectConnectionStub);
      assert.deepStrictEqual(secondCallEnvironments, []);

      // Now fix the stub to return a valid connection spec
      getDirectConnectionStub.resolves(connectionSpec);
      const thirdCallEnvironments = await loader.getEnvironments();
      sinon.assert.calledThrice(getDirectConnectionStub);
      assert.strictEqual(thirdCallEnvironments.length, 1);

      // Fourth call should use cache now
      const fourthCallEnvironments = await loader.getEnvironments();
      sinon.assert.calledThrice(getDirectConnectionStub); // Should still be 3 calls
      assert.strictEqual(fourthCallEnvironments.length, 1);
    });
  });

  describe("reset()", () => {
    it("Clears the cached environments", async () => {
      await loader.getEnvironments(); // Load and cache first.
      sinon.assert.calledOnce(getDirectConnectionStub);
      await loader.reset(); // Clear the cache.
      await loader.getEnvironments(); // Should call the stub again.
      sinon.assert.calledTwice(getDirectConnectionStub); // Should have called the stub again.
    });
  });

  describe("getKafkaClustersForEnvironmentId()", () => {
    it("Returns Kafka clusters for the specified environment ID", async () => {
      const kafkaClusters = await loader.getKafkaClustersForEnvironmentId(
        TEST_DIRECT_ENVIRONMENT_ID,
      );
      assert.strictEqual(kafkaClusters.length, 1);
      assert.strictEqual(
        kafkaClusters[0].bootstrapServers,
        TEST_DIRECT_KAFKA_CLUSTER.bootstrapServers,
      );
    });

    it("Returns empty array for unknown environment ID", async () => {
      const empty = await loader.getKafkaClustersForEnvironmentId(
        "unknown-environment-id" as EnvironmentId,
      );
      assert.deepStrictEqual([], empty);
    });
  });

  describe("getSchemaRegistries()", () => {
    it("Returns the expected schema registry", async () => {
      const schemaRegistries = await loader.getSchemaRegistries();
      assert.strictEqual(schemaRegistries.length, 1);
      assert.strictEqual(schemaRegistries[0].uri, TEST_DIRECT_SCHEMA_REGISTRY.uri);
    });

    it("Returns an empty array if no schema registries are configured", async () => {
      // Create a spec without schema registry
      const specWithoutSR = {
        ...connectionSpec,
        schemaRegistry: undefined,
      };
      getDirectConnectionStub.resolves(specWithoutSR);

      // Reset to clear cache and force re-fetch
      await loader.reset();
      const schemaRegistries = await loader.getSchemaRegistries();
      assert.deepStrictEqual(schemaRegistries, []);
    });
  });

  describe("getSchemaRegistryForEnvironmentId()", () => {
    it("Returns the schema registry for the specified environment ID", async () => {
      const schemaRegistry = await loader.getSchemaRegistryForEnvironmentId(
        TEST_DIRECT_ENVIRONMENT_ID,
      );
      assert.ok(schemaRegistry);
      assert.strictEqual(schemaRegistry.uri, TEST_DIRECT_SCHEMA_REGISTRY.uri);
    });

    it("Returns undefined for an environment without a schema registry", async () => {
      const schemaRegistry = await loader.getSchemaRegistryForEnvironmentId(
        "another-environment-id" as EnvironmentId,
      );
      assert.strictEqual(schemaRegistry, undefined);
    });
  });
});
