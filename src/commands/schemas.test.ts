import * as assert from "assert";
import sinon from "sinon";
import * as vscode from "vscode";
import { commands } from "vscode";
import {
  TEST_CCLOUD_KAFKA_TOPIC,
  TEST_CCLOUD_SCHEMA,
  TEST_CCLOUD_SCHEMA_REGISTRY,
  TEST_LOCAL_KAFKA_TOPIC,
  TEST_LOCAL_SCHEMA,
  TEST_LOCAL_SCHEMA_REGISTRY,
} from "../../tests/unit/testResources";
import { CCloudResourceLoader, LocalResourceLoader, ResourceLoader } from "../loaders";
import { ContainerTreeItem } from "../models/main";
import { Schema } from "../models/schema";
import { SchemaRegistry } from "../models/schemaRegistry";
import { KafkaTopic } from "../models/topic";
import {
  CannotLoadSchemasError,
  diffLatestSchemasCommand,
  getLatestSchemasForTopic,
} from "./schemas";

describe("commands/schemas.ts diffLatestSchemasCommand tests", function () {
  let sandbox: sinon.SinonSandbox;
  let executeCommandStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    executeCommandStub = sandbox.stub(commands, "executeCommand");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("diffLatestSchemasCommand should execute the correct commands when invoked on a proper schema group", async () => {
    // Make a 3-version schema group ...
    const oldestSchemaVersion = Schema.create({
      ...TEST_CCLOUD_SCHEMA,
      subject: "my-topic-value",
      version: 0,
      id: "1",
    });

    const olderSchemaVersion = Schema.create({
      ...TEST_CCLOUD_SCHEMA,
      subject: "my-topic-value",
      version: 1,
      id: "2",
    });
    const latestSchemaVersion = Schema.create({
      ...TEST_CCLOUD_SCHEMA,
      subject: "my-topic-value",
      version: 2,
      id: "3",
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
      [Schema.create({ ...TEST_CCLOUD_SCHEMA, subject: "my-topic-value", version: 1 })],
    );

    await diffLatestSchemasCommand(schemaGroup);
    assert.ok(executeCommandStub.notCalled);
  });
});

// Run one set of tests for the local resource loader and another for the CCloud resource loader
describe(
  "commands/schemas.ts getLatestSchemasForTopic vs local registry tests",
  generateGetLatestSchemasForTopicTests(
    LocalResourceLoader,
    TEST_LOCAL_KAFKA_TOPIC,
    TEST_LOCAL_SCHEMA,
    TEST_LOCAL_SCHEMA_REGISTRY,
  ),
);

describe(
  "commands/schemas.ts getLatestSchemasForTopic vs CCLoud registry tests",
  generateGetLatestSchemasForTopicTests(
    CCloudResourceLoader,
    TEST_CCLOUD_KAFKA_TOPIC,
    TEST_CCLOUD_SCHEMA,
    TEST_CCLOUD_SCHEMA_REGISTRY,
  ),
);

/** Generic function used to generate same tests over getLatestSchemasForTopic() for varying ResourceLoaders */
function generateGetLatestSchemasForTopicTests<
  ResourceLoaderType extends ResourceLoader,
  SchemaRegistryType extends SchemaRegistry,
>(
  resourceLoaderClass: Constructor<ResourceLoaderType>,
  baseTopic: KafkaTopic,
  testSchema: Schema,
  baseSchemaRegistry: SchemaRegistryType,
): () => void {
  return function () {
    let sandbox: sinon.SinonSandbox;
    let resourceLoaderStub: sinon.SinonStub;
    let resourceLoader: sinon.SinonStubbedInstance<ResourceLoaderType>;
    let testTopic: KafkaTopic;

    beforeEach(function () {
      sandbox = sinon.createSandbox();
      resourceLoaderStub = sandbox.stub(ResourceLoader, "getInstance");
      resourceLoader = sandbox.createStubInstance(resourceLoaderClass);
      resourceLoaderStub.returns(resourceLoader);

      // Ensure that testTopic smells like it has a schema and is named "test-topic", the default expectation of these tests.
      testTopic = KafkaTopic.create({ ...baseTopic, hasSchema: true, name: "test-topic" });
    });

    afterEach(function () {
      sandbox.restore();
    });

    it("hates topics without schemas", async function () {
      await assert.rejects(
        async () => {
          await getLatestSchemasForTopic(KafkaTopic.create({ ...testTopic, hasSchema: false }));
        },
        raisedErrorMatcher(
          /Asked to get schemas for topic "test-topic" believed to not have schema/,
        ),
      );
    });

    it("hates topics without schema registry", async function () {
      // mock resourceLoader.getCCloudSchemaRegistry() to return undefined, no schema registry
      resourceLoader.getSchemaRegistryForEnvironmentId.resolves(undefined);
      await assert.rejects(
        async () => {
          await getLatestSchemasForTopic(testTopic);
        },
        raisedCannotLoadSchemasErrorMatcher(
          /Could not determine schema registry for topic "test-topic" believed to have related schemas/,
        ),
      );
    });

    it("hates empty schema registry", async function () {
      resourceLoader.getSchemaRegistryForEnvironmentId.resolves(baseSchemaRegistry);
      resourceLoader.getSchemasForRegistry.resolves([]);
      await assert.rejects(
        async () => {
          await getLatestSchemasForTopic(testTopic);
        },
        raisedCannotLoadSchemasErrorMatcher(
          /Schema registry .* had no schemas, but we expected it to have some for topic "test-topic"/,
        ),
      );
    });

    it("hates when no schemas match topic", async function () {
      resourceLoader.getSchemaRegistryForEnvironmentId.resolves(baseSchemaRegistry);
      resourceLoader.getSchemasForRegistry.resolves([
        Schema.create({ ...testSchema, subject: "some-other-topic-value" }),
      ]);
      await assert.rejects(
        async () => {
          await getLatestSchemasForTopic(testTopic);
        },
        raisedCannotLoadSchemasErrorMatcher(/No schemas found for topic "test-topic"/),
      );
    });

    it("loves and returns highest versioned schemas for topic with key and value topics", async function () {
      resourceLoader.getSchemaRegistryForEnvironmentId.resolves(baseSchemaRegistry);
      resourceLoader.getSchemasForRegistry.resolves([
        Schema.create({ ...testSchema, subject: "test-topic-value", version: 1 }),
        Schema.create({ ...testSchema, subject: "test-topic-value", version: 2 }),
        Schema.create({ ...testSchema, subject: "test-topic-key", version: 1 }),
      ]);

      const fetchedLatestSchemas = await getLatestSchemasForTopic(testTopic);
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
  };
}

/**
 * Generic interface for types with a constructor function (i.e. a real class)
 *
 * Needed to constrain to types that have constructors as a requirement
 * for generic typing over types to be fed into sandbox.createStubInstance()
 */
interface Constructor<T> {
  new (...args: any[]): T;
}

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
