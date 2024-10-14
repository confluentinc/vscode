import * as assert from "assert";
import * as vscode from "vscode";
import sinon from "sinon";
import { commands } from "vscode";
import {
  TEST_CCLOUD_KAFKA_TOPIC,
  TEST_LOCAL_KAFKA_TOPIC,
  TEST_SCHEMA,
  TEST_SCHEMA_REGISTRY,
} from "../../tests/unit/testResources";
import { Schema } from "../models/schema";
import { KafkaTopic } from "../models/topic";
import { ResourceManager } from "../storage/resourceManager";
import {
  CannotLoadSchemasError,
  getLatestSchemasForTopic,
  diffLatestSchemasCommand,
} from "./schemas";
import { ContainerTreeItem } from "../models/main";

describe("commands/schemas.ts diffLatestSchemasCommand tests", function () {
  let executeCommandStub: sinon.SinonStub;

  beforeEach(() => {
    executeCommandStub = sinon.stub(commands, "executeCommand");
  });

  afterEach(() => {
    sinon.restore();
  });

  it("diffLatestSchemasCommand should execute the correct commands when invoked on a proper schema group", async () => {
    // Make a 3-version schema group ...
    const oldestSchemaVersion = Schema.create({
      ...TEST_SCHEMA,
      subject: "my-topic-value",
      version: 0,
    });

    const olderSchemaVersion = Schema.create({
      ...TEST_SCHEMA,
      subject: "my-topic-value",
      version: 1,
    });
    const latestSchemaVersion = Schema.create({
      ...TEST_SCHEMA,
      subject: "my-topic-value",
      version: 2,
    });
    const schemaGroup = new ContainerTreeItem<Schema>(
      "my-topic-value",
      vscode.TreeItemCollapsibleState.Collapsed,
      [latestSchemaVersion, olderSchemaVersion, oldestSchemaVersion],
    );

    // directly call what command "confluent.schemas.diffMostRecentVersions" would call (made harder to invoke
    // because it's a command, and we've stubbed out vscode command execution)
    await diffLatestSchemasCommand(schemaGroup);
    assert.ok(executeCommandStub.calledWith("confluent.diff.selectForCompare", olderSchemaVersion));
    assert.ok(
      executeCommandStub.calledWith("confluent.diff.compareWithSelected", latestSchemaVersion),
    );
  });

  it("diffLatestSchemasCommand should not execute commands if there are fewer than two schemas in the group", async () => {
    // (this should not happen if the schema group was generated correctly, but diffLatestSchemasCommand guards against it)
    const schemaGroup = new ContainerTreeItem<Schema>(
      "my-topic-value",
      vscode.TreeItemCollapsibleState.Collapsed,
      [Schema.create({ ...TEST_SCHEMA, subject: "my-topic-value", version: 1 })],
    );

    await diffLatestSchemasCommand(schemaGroup);
    assert.ok(executeCommandStub.notCalled);
  });
});

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
      raisedErrorMatcher(/Asked to get schemas for topic "test-topic" believed to not have schema/),
    );
  });

  it("hates local topics (at this time)", async function () {
    await assert.rejects(
      async () => {
        await getLatestSchemasForTopic(
          KafkaTopic.create({ ...TEST_LOCAL_KAFKA_TOPIC, hasSchema: true }),
        );
      },
      raisedErrorMatcher(/Asked to get schemas for local topic "test-topic"/),
    );
  });

  it("hates topics without schema registry", async function () {
    // mock resourceManager.getCCloudSchemaRegistry() to return null
    resourceManager.getCCloudSchemaRegistry.resolves(null);
    await assert.rejects(
      async () => {
        await getLatestSchemasForTopic(TEST_CCLOUD_KAFKA_TOPIC);
      },
      raisedCannotLoadSchemasErrorMatcher(
        /Could not determine schema registry for topic "test-topic" believed to have related schemas/,
      ),
    );
  });

  it("hates empty schema registry", async function () {
    resourceManager.getCCloudSchemaRegistry.resolves(TEST_SCHEMA_REGISTRY);
    resourceManager.getSchemasForRegistry.resolves([]);
    await assert.rejects(
      async () => {
        await getLatestSchemasForTopic(TEST_CCLOUD_KAFKA_TOPIC);
      },
      raisedCannotLoadSchemasErrorMatcher(
        /Schema registry .* had no schemas, but we expected it to have some for topic "test-topic"/,
      ),
    );
  });

  it("hates when no schemas match topic", async function () {
    resourceManager.getCCloudSchemaRegistry.resolves(TEST_SCHEMA_REGISTRY);
    resourceManager.getSchemasForRegistry.resolves([
      Schema.create({ ...TEST_SCHEMA, subject: "some-other-topic-value" }),
    ]);
    await assert.rejects(
      async () => {
        await getLatestSchemasForTopic(TEST_CCLOUD_KAFKA_TOPIC);
      },
      raisedCannotLoadSchemasErrorMatcher(/No schemas found for topic "test-topic"/),
    );
  });

  it("loves and returns highest versioned schemas for topic with key and value topics", async function () {
    resourceManager.getCCloudSchemaRegistry.resolves(TEST_SCHEMA_REGISTRY);
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

/** Function generator that returns a matcher function that checks if the error message matches the given regex
 *  and that the exception is an instance of Error (and only Error, not a subclass)
 */
function raisedErrorMatcher(matcher: RegExp): (error: any) => boolean {
  return (error: any) => {
    return error instanceof Error && error.constructor === Error && matcher.test(error.message);
  };
}

/**
 * Error matcher function generator that checks if the error is an instance of CannotLoadSchemasError and that the error message
 * matches the given regex.
 */
function raisedCannotLoadSchemasErrorMatcher(matcher: RegExp): (error: any) => boolean {
  return (error: any) => {
    return error instanceof CannotLoadSchemasError && matcher.test(error.message);
  };
}
