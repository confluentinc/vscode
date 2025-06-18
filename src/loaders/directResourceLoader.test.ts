import assert from "assert";
import * as sinon from "sinon";

import {
  TEST_DIRECT_ENVIRONMENT,
  TEST_DIRECT_ENVIRONMENT_ID,
  TEST_DIRECT_KAFKA_CLUSTER,
  TEST_DIRECT_SCHEMA_REGISTRY,
} from "../../tests/unit/testResources";
import { TEST_DIRECT_CONNECTION_ID } from "../../tests/unit/testResources/connection";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import * as directGraphQl from "../graphql/direct";
import { DirectEnvironment } from "../models/environment";
import { EnvironmentId } from "../models/resource";
import { DirectResourceLoader } from "./directResourceLoader";

describe("DirectResourceLoader", () => {
  let myEnvironment: DirectEnvironment;

  let sandbox: sinon.SinonSandbox;
  let loader: DirectResourceLoader;
  let getDirectResourcesStub: sinon.SinonStub;

  before(async () => {
    await getTestExtensionContext();
  });

  beforeEach(async () => {
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

    // Ensure workspace storage cached data for this connection id is cleared before each test.
    await loader.reset();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("getEnvironments()", () => {
    it("Deep fetches once and caches the result", async () => {
      const environments = await loader.getEnvironments();
      sinon.assert.calledOnce(getDirectResourcesStub);
      assert.deepStrictEqual(environments, [myEnvironment], "first fetch");

      // Call again, should not call the stub again.
      const cachedEnvironments = await loader.getEnvironments();
      sinon.assert.calledOnce(getDirectResourcesStub);
      assert.deepStrictEqual(cachedEnvironments, [myEnvironment], "secton fetch");

      // Call with forceDeepRefresh, should call the stub again.
      const refreshedEnvironments = await loader.getEnvironments(true);
      sinon.assert.calledTwice(getDirectResourcesStub);
      assert.deepStrictEqual(refreshedEnvironments, [myEnvironment], "third fetch");
    });

    it("should not cache when getDirectResources returns undefined and retry on next call", async () => {
      // Stub getDirectResources to return undefined (simulating GraphQL query failure)
      getDirectResourcesStub.resolves(undefined);

      const environments = await loader.getEnvironments();
      sinon.assert.calledOnce(getDirectResourcesStub);
      assert.deepStrictEqual(environments, []);

      // Call again, should call the stub again since nothing was cached
      const secondCallEnvironments = await loader.getEnvironments();
      sinon.assert.calledTwice(getDirectResourcesStub);
      assert.deepStrictEqual(secondCallEnvironments, []);

      // Now fix the stub to return a valid environment
      getDirectResourcesStub.resolves(myEnvironment);
      const thirdCallEnvironments = await loader.getEnvironments();
      sinon.assert.calledThrice(getDirectResourcesStub);
      assert.deepStrictEqual(thirdCallEnvironments, [myEnvironment]);

      // Fourth call should use cache now
      const fourthCallEnvironments = await loader.getEnvironments();
      sinon.assert.calledThrice(getDirectResourcesStub); // Should still be 3 calls
      assert.deepStrictEqual(fourthCallEnvironments, [myEnvironment]);
    });
  });

  describe("purgeCache()", () => {
    it("Clears the cached environments", async () => {
      await loader.getEnvironments(); // Load and cache first.
      sinon.assert.calledOnce(getDirectResourcesStub);
      loader.reset(); // Clear the cache.
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
