import * as assert from "assert";
import sinon from "sinon";
import { Schema } from "../models/schema";
import { ResourceManager } from "../storage/resourceManager";
import { getLatestSchemasForTopic } from "./schemas";
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

  it("hates local topics", async function () {
    assert.rejects(async () => {
      await getLatestSchemasForTopic(TEST_LOCAL_KAFKA_TOPIC);
    }, /Cannot get schemas for local topics/);
  });

  it("hates topics without schemas", async function () {
    assert.rejects(async () => {
      await getLatestSchemasForTopic(TEST_CCLOUD_KAFKA_TOPIC);
    }, /"asked to get schemas for a topic believed to not have schemas/);
  });

  it("hates topics without schema registry", async function () {
    // mock resourceManager.getCCloudSchemaRegistryCluster() to return null
    resourceManager.getCCloudSchemaRegistryCluster.resolves(null);
    assert.rejects(async () => {
      await getLatestSchemasForTopic(TEST_CCLOUD_KAFKA_TOPIC);
    }, /could not determine schema registry for a topic with known schemas/);
  });

  it("hates empty schema registry", async function () {
    resourceManager.getCCloudSchemaRegistryCluster.resolves(TEST_SCHEMA_REGISTRY);
    resourceManager.getSchemasForRegistry.resolves([]);
    assert.rejects(async () => {
      await getLatestSchemasForTopic(TEST_CCLOUD_KAFKA_TOPIC);
    }, /had no schemas, but we highly expected them/);
  });

  it("hates when no schemas match topic", async function () {
    resourceManager.getCCloudSchemaRegistryCluster.resolves(TEST_SCHEMA_REGISTRY);
    resourceManager.getSchemasForRegistry.resolves([
      Schema.create({ ...TEST_SCHEMA, subject: "some-other-topic-value" }),
    ]);
    assert.rejects(async () => {
      await getLatestSchemasForTopic(TEST_CCLOUD_KAFKA_TOPIC);
    }, /No schemas found for topic "test-topic", but highly expected them/);
  });

  it("returns highest versioned schemas for topic", async function () {
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
