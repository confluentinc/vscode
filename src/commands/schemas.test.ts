import * as assert from "assert";
import sinon from "sinon";
import { commands } from "vscode";
import {
  TEST_CCLOUD_KAFKA_TOPIC,
  TEST_CCLOUD_SCHEMA,
  TEST_CCLOUD_SCHEMA_REGISTRY,
  TEST_CCLOUD_SCHEMA_REVISED,
  TEST_CCLOUD_SUBJECT,
  TEST_CCLOUD_SUBJECT_WITH_SCHEMAS,
  TEST_LOCAL_KAFKA_TOPIC,
  TEST_LOCAL_SCHEMA,
  TEST_LOCAL_SCHEMA_REGISTRY,
  TEST_LOCAL_SUBJECT_WITH_SCHEMAS,
} from "../../tests/unit/testResources";
import { CCloudResourceLoader, LocalResourceLoader, ResourceLoader } from "../loaders";
import { Schema, Subject } from "../models/schema";
import { SchemaRegistry } from "../models/schemaRegistry";
import { KafkaTopic } from "../models/topic";
import {
  CannotLoadSchemasError,
  determineLatestSchema,
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
    // directly call what command "confluent.schemas.diffMostRecentVersions" would call (made harder to invoke
    // because it's a command, and we've stubbed out vscode command execution)
    await diffLatestSchemasCommand(TEST_CCLOUD_SUBJECT_WITH_SCHEMAS);
    assert.ok(
      executeCommandStub.calledWith(
        "confluent.diff.selectForCompare",
        TEST_CCLOUD_SUBJECT_WITH_SCHEMAS.schemas![1],
      ),
    );
    assert.ok(
      executeCommandStub.calledWith(
        "confluent.diff.compareWithSelected",
        TEST_CCLOUD_SUBJECT_WITH_SCHEMAS.schemas![0],
      ),
    );
  });

  it("diffLatestSchemasCommand should not execute commands if there are fewer than two schemas in the group", async () => {
    // (this should not happen if the schema group was generated correctly, but diffLatestSchemasCommand guards against it)
    const schemaGroup = new Subject(
      TEST_CCLOUD_SUBJECT.name,
      TEST_CCLOUD_SUBJECT.connectionId,
      TEST_CCLOUD_SUBJECT.environmentId,
      TEST_CCLOUD_SUBJECT.schemaRegistryId,
      [TEST_CCLOUD_SCHEMA_REVISED],
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

    it("hates topics without subject groups", async function () {
      resourceLoader.getTopicSubjectGroups.resolves([]);
      await assert.rejects(
        async () => {
          await getLatestSchemasForTopic(testTopic);
        },
        raisedCannotLoadSchemasErrorMatcher(
          /Topic "test-topic" has no related schemas in registry/,
        ),
      );
    });

    it("loves and returns highest versioned schemas for topic with key and value topics", async function () {
      resourceLoader.getSchemaRegistryForEnvironmentId.resolves(baseSchemaRegistry);

      // Doesn't really matter that we're mixing local and CCloud here, just wanting to test returning
      // multiple subjects with multiple schemas each.
      resourceLoader.getTopicSubjectGroups.resolves([
        TEST_LOCAL_SUBJECT_WITH_SCHEMAS,
        TEST_CCLOUD_SUBJECT_WITH_SCHEMAS,
      ]);

      const fetchedLatestSchemas = await getLatestSchemasForTopic(testTopic);
      assert.strictEqual(fetchedLatestSchemas.length, 2);

      const expectedSubjectToVersion: Map<string, number> = new Map([
        [TEST_LOCAL_SUBJECT_WITH_SCHEMAS.name, 2],
        [TEST_CCLOUD_SUBJECT_WITH_SCHEMAS.name, 2],
      ]);

      for (const schema of fetchedLatestSchemas) {
        assert.strictEqual(schema.version, expectedSubjectToVersion.get(schema.subject));
        expectedSubjectToVersion.delete(schema.subject);
      }

      // should have been all.
      assert.strictEqual(expectedSubjectToVersion.size, 0);
    });
  };
}

describe("commands::schema determineLatestSchema() tests", () => {
  let sandbox: sinon.SinonSandbox;
  let loaderStub: sinon.SinonStubbedInstance<ResourceLoader>;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    loaderStub = sandbox.createStubInstance(ResourceLoader);
    sandbox.stub(ResourceLoader, "getInstance").returns(loaderStub);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should return first Schema from a Subject carrying Schemas", async () => {
    const result = await determineLatestSchema("test", TEST_CCLOUD_SUBJECT_WITH_SCHEMAS);
    assert.strictEqual(result, TEST_CCLOUD_SUBJECT_WITH_SCHEMAS.schemas![0]);
  });

  it("should fetch and return latest Schema when given Subject", async () => {
    const expectedSchema = TEST_CCLOUD_SCHEMA;
    const subject = TEST_CCLOUD_SUBJECT;

    loaderStub.getSchemaSubjectGroup.resolves([expectedSchema]);

    const result = await determineLatestSchema("test", subject);

    assert.strictEqual(result, expectedSchema);
  });

  it("should throw error for invalid argument type", async () => {
    await assert.rejects(
      async () => await determineLatestSchema("test", {} as Subject),
      /called with invalid argument type/,
    );
  });
});

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
