import * as assert from "assert";
import sinon from "sinon";
import { workspace } from "vscode";
import {
  TEST_LOCAL_SCHEMA,
  TEST_LOCAL_SCHEMA_REVISED,
} from "../../../tests/unit/testResources/schema";
import { TEST_LOCAL_SCHEMA_REGISTRY } from "../../../tests/unit/testResources/schemaRegistry";
import { TEST_LOCAL_KAFKA_TOPIC } from "../../../tests/unit/testResources/topic";
import * as errors from "../../errors";
import { LocalResourceLoader, ResourceLoader } from "../../loaders";
import { ALLOW_OLDER_SCHEMA_VERSIONS } from "../../preferences/constants";
import { SubjectNameStrategy } from "../../schemas/produceMessageSchema";
import * as schemaQuickPicks from "../schemas";
import * as schemaSubjects from "./schemaSubjects";
import { promptForSchema } from "./schemas";

describe("quickpicks/utils/schemas.ts promptForSchema()", () => {
  let sandbox: sinon.SinonSandbox;

  let showErrorNotificationStub: sinon.SinonStub;

  let getSchemaRegistriesStub: sinon.SinonStub;
  let getSubjectNameForStrategyStub: sinon.SinonStub;
  let schemaVersionQuickPickStub: sinon.SinonStub;
  let getSchemasForEnvironmentIdStub: sinon.SinonStub;
  let getConfigurationStub: sinon.SinonStub;

  let resourceLoaderStub: sinon.SinonStub;
  // use local loaders for these tests; no functional difference between local/CCloud/direct here
  let resourceLoader: sinon.SinonStubbedInstance<LocalResourceLoader>;

  const testSchemas = [
    TEST_LOCAL_SCHEMA_REVISED, // version 2
    TEST_LOCAL_SCHEMA, // version 1
  ];

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // vscode stubs
    showErrorNotificationStub = sandbox.stub(errors, "showErrorNotificationWithButtons");

    // ResourceLoader stubs
    resourceLoaderStub = sandbox.stub(ResourceLoader, "getInstance");
    resourceLoader = sandbox.createStubInstance(LocalResourceLoader);
    resourceLoaderStub.returns(resourceLoader);
    getSchemaRegistriesStub = resourceLoader.getSchemaRegistries.resolves([
      TEST_LOCAL_SCHEMA_REGISTRY,
    ]);
    getSchemasForEnvironmentIdStub =
      resourceLoader.getSchemasForEnvironmentId.resolves(testSchemas);

    // quickpick+util stubs
    schemaVersionQuickPickStub = sandbox.stub(schemaQuickPicks, "schemaVersionQuickPick");
    getSubjectNameForStrategyStub = sandbox
      .stub(schemaSubjects, "getSubjectNameForStrategy")
      .resolves(TEST_LOCAL_SCHEMA.subject);

    // stub the WorkspaceConfiguration
    getConfigurationStub = sandbox.stub(workspace, "getConfiguration");
    getConfigurationStub.returns({
      get: sandbox.stub(),
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should throw an error when no Schema Registry is found", async () => {
    // no SR instances loaded
    getSchemaRegistriesStub.resolves([]);

    await assert.rejects(
      async () => promptForSchema(TEST_LOCAL_KAFKA_TOPIC, "key", SubjectNameStrategy.TOPIC_NAME),
      { message: `No Schema Registry available for topic "${TEST_LOCAL_KAFKA_TOPIC.name}".` },
    );
    sinon.assert.calledOnce(showErrorNotificationStub);
    sinon.assert.notCalled(schemaVersionQuickPickStub);
    sinon.assert.notCalled(getSchemasForEnvironmentIdStub);
    sinon.assert.notCalled(getSubjectNameForStrategyStub);
  });

  it("should throw an error when no schema subject is found", async () => {
    // no schema subject loaded
    getSubjectNameForStrategyStub.resolves(undefined);

    await assert.rejects(
      async () => promptForSchema(TEST_LOCAL_KAFKA_TOPIC, "key", SubjectNameStrategy.TOPIC_NAME),
      { message: `"key" schema subject not found/set for topic "${TEST_LOCAL_KAFKA_TOPIC.name}".` },
    );
    // don't check for error notification here since it depends on the settings and quickpick path
    // and will only be shown for TopicNameStrategy
    sinon.assert.notCalled(schemaVersionQuickPickStub);
    sinon.assert.notCalled(getSchemasForEnvironmentIdStub);
  });

  it("should use schemaVersionQuickPick when `allowOlderVersions` is true", async () => {
    // allowOlderVersions setting enabled
    getConfigurationStub.returns({
      get: sandbox.stub().withArgs(ALLOW_OLDER_SCHEMA_VERSIONS, false).returns(true),
    });
    // user selects the schema version quick pick
    schemaVersionQuickPickStub.resolves(TEST_LOCAL_SCHEMA);

    const result = await promptForSchema(
      TEST_LOCAL_KAFKA_TOPIC,
      "value",
      SubjectNameStrategy.TOPIC_NAME,
    );

    sinon.assert.calledOnceWithExactly(
      schemaVersionQuickPickStub,
      TEST_LOCAL_SCHEMA_REGISTRY,
      TEST_LOCAL_SCHEMA.subject,
    );
    assert.strictEqual(result, TEST_LOCAL_SCHEMA);
  });

  it("should throw an error when user cancels schema version selection", async () => {
    // allowOlderVersions setting enabled
    getConfigurationStub.returns({
      get: sandbox.stub().withArgs(ALLOW_OLDER_SCHEMA_VERSIONS, false).returns(true),
    });
    // user cancels the schema version quick pick
    schemaVersionQuickPickStub.resolves(undefined);

    await assert.rejects(
      async () => promptForSchema(TEST_LOCAL_KAFKA_TOPIC, "value", SubjectNameStrategy.TOPIC_NAME),
      { message: "Schema version not chosen." },
    );
    sinon.assert.calledOnce(schemaVersionQuickPickStub);
    sinon.assert.notCalled(getSchemasForEnvironmentIdStub);
    sinon.assert.notCalled(showErrorNotificationStub);
  });

  it("should return the latest schema version when `allowOlderVersions` is false", async () => {
    getSchemasForEnvironmentIdStub.resolves(testSchemas);

    const result = await promptForSchema(
      TEST_LOCAL_KAFKA_TOPIC,
      "value",
      SubjectNameStrategy.TOPIC_NAME,
    );

    sinon.assert.notCalled(schemaVersionQuickPickStub);
    assert.strictEqual(result, testSchemas[0]); // latest version
  });

  it("should throw an error when no schema versions are found for the subject", async () => {
    getSchemasForEnvironmentIdStub.resolves([]);

    await assert.rejects(
      async () => promptForSchema(TEST_LOCAL_KAFKA_TOPIC, "value", SubjectNameStrategy.TOPIC_NAME),
      { message: `No schema versions found for subject "${TEST_LOCAL_SCHEMA.subject}".` },
    );
    assert.ok(showErrorNotificationStub.calledOnce);
  });

  it("should throw an error when schema versions exist but none match the subject", async () => {
    // schema with unrelated subject
    const differentSubjectSchema = {
      ...TEST_LOCAL_SCHEMA,
      subject: "different-subject",
    };

    getSchemasForEnvironmentIdStub.resolves([differentSubjectSchema]);

    await assert.rejects(
      async () => promptForSchema(TEST_LOCAL_KAFKA_TOPIC, "value", SubjectNameStrategy.TOPIC_NAME),
      { message: `No schema versions found for subject "${TEST_LOCAL_SCHEMA.subject}".` },
    );
    assert.ok(showErrorNotificationStub.calledOnce);
  });
});
