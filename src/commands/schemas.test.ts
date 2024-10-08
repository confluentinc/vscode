import * as assert from "assert";
import sinon from "sinon";
import { Schema } from "../models/schema";
import { KafkaTopic } from "../models/topic";
import { ResourceManager } from "../storage/resourceManager";
import { CannotLoadSchemasError, getLatestSchemasForTopic } from "./schemas";
import {
  TEST_CCLOUD_KAFKA_TOPIC,
  TEST_LOCAL_KAFKA_TOPIC,
  TEST_SCHEMA_REGISTRY,
  TEST_SCHEMA,
} from "../../tests/unit/testResources";

describe("commands/schemas.ts getLatestSchemasForTopic tests", function () {
  let sandbox: sinon.SinonSandbox;
  let resourceManagerStub: sinon.SinonStub;
  let resourceManager: sinon.SinonStubbedInstance<ResourceManager>;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    resourceManagerStub = sandbox.stub(ResourceManager, "getInstance");
    resourceManager = sandbox.createStubInstance(ResourceManager);
    resourceManagerStub.returns(resourceManager);
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("hates topics without schemas", async function () {
    await assert.rejects(
      async () => {
        await getLatestSchemasForTopic(
          KafkaTopic.create({ ...TEST_LOCAL_KAFKA_TOPIC, hasSchema: false }),
        );
      },
      (error) => {
        return (
          // Should exactly be Error, not subclass
          error instanceof Error &&
          error.constructor === Error &&
          /Asked to get schemas for topic test-topic believed to not have schema/.test(
            error.message,
          )
        );
      },
    );
  });

  it("hates topics without schema registry", async function () {
    // mock resourceManager.getCCloudSchemaRegistryCluster() to return null
    resourceManager.getCCloudSchemaRegistryCluster.resolves(null);
    await assert.rejects(
      async () => {
        await getLatestSchemasForTopic(TEST_CCLOUD_KAFKA_TOPIC);
      },
      (error) => {
        return (
          error instanceof CannotLoadSchemasError &&
          /Could not determine schema registry for topic test-topic believed to have related schemas/.test(
            error.message,
          )
        );
      },
    );
  });

  it("hates empty schema registry", async function () {
    resourceManager.getCCloudSchemaRegistryCluster.resolves(TEST_SCHEMA_REGISTRY);
    resourceManager.getSchemasForRegistry.resolves([]);
    await assert.rejects(
      async () => {
        await getLatestSchemasForTopic(TEST_CCLOUD_KAFKA_TOPIC);
      },
      (error) => {
        return (
          error instanceof CannotLoadSchemasError &&
          /Schema registry .* had no schemas, but we expected it to have some for topic "test-topic"/.test(
            error.message,
          )
        );
      },
    );
  });

  it("hates when no schemas match topic", async function () {
    resourceManager.getCCloudSchemaRegistryCluster.resolves(TEST_SCHEMA_REGISTRY);
    resourceManager.getSchemasForRegistry.resolves([
      Schema.create({ ...TEST_SCHEMA, subject: "some-other-topic-value" }),
    ]);
    await assert.rejects(
      async () => {
        await getLatestSchemasForTopic(TEST_CCLOUD_KAFKA_TOPIC);
      },
      (error) => {
        return (
          error instanceof CannotLoadSchemasError &&
          /No schemas found for topic "test-topic"/.test(error.message)
        );
      },
    );
  });

  it("loves and returns highest versioned schemas for topic with key and value topics", async function () {
    resourceManager.getCCloudSchemaRegistryCluster.resolves(TEST_SCHEMA_REGISTRY);
    resourceManager.getSchemasForRegistry.resolves([
      Schema.create({ ...TEST_SCHEMA, subject: "test-topic-value", version: 1 }),
      Schema.create({ ...TEST_SCHEMA, subject: "test-topic-value", version: 2 }),
      Schema.create({ ...TEST_SCHEMA, subject: "test-topic-key", version: 1 }),
    ]);

    const fetchedLatestSchemas = await getLatestSchemasForTopic(TEST_CCLOUD_KAFKA_TOPIC);
    assert.strictEqual(fetchedLatestSchemas.length, 2);

    const expectedSubjectToVersion = new Map([
      ["test-topic-value", 2],
      ["test-topic-key", 1],
    ]);

    for (const schema of fetchedLatestSchemas) {
      assert.strictEqual(schema.version, expectedSubjectToVersion.get(schema.subject));
      expectedSubjectToVersion.delete(schema.subject);
    }
  });
});
