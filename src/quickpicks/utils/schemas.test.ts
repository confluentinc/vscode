import * as assert from "assert";
import sinon from "sinon";
import { getStubbedLocalResourceLoader } from "../../../tests/stubs/resourceLoaders";
import { StubbedWorkspaceConfiguration } from "../../../tests/stubs/workspaceConfiguration";
import {
  TEST_LOCAL_SCHEMA,
  TEST_LOCAL_SCHEMA_REVISED,
} from "../../../tests/unit/testResources/schema";
import { TEST_LOCAL_SCHEMA_REGISTRY } from "../../../tests/unit/testResources/schemaRegistry";
import { TEST_LOCAL_KAFKA_TOPIC } from "../../../tests/unit/testResources/topic";
import { ALLOW_OLDER_SCHEMA_VERSIONS } from "../../extensionSettings/constants";
import { LocalResourceLoader } from "../../loaders";
import * as notifications from "../../notifications";
import { SubjectNameStrategy } from "../../schemas/produceMessageSchema";
import * as schemaQuickPicks from "../schemas";
import * as schemaSubjects from "./schemaSubjects";
import { promptForSchema } from "./schemas";

describe("quickpicks/utils/schemas.ts promptForSchema()", () => {
  let sandbox: sinon.SinonSandbox;

  let showErrorNotificationStub: sinon.SinonStub;

  let getSubjectNameForStrategyStub: sinon.SinonStub;
  let schemaVersionQuickPickStub: sinon.SinonStub;

  let stubbedConfigs: StubbedWorkspaceConfiguration;

  // use local loaders for these tests; no functional difference between local/CCloud/direct here
  let stubbedLoader: sinon.SinonStubbedInstance<LocalResourceLoader>;

  const testSchemas = [
    TEST_LOCAL_SCHEMA_REVISED, // version 2
    TEST_LOCAL_SCHEMA, // version 1
  ];

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // vscode stubs
    showErrorNotificationStub = sandbox.stub(notifications, "showErrorNotificationWithButtons");

    // ResourceLoader stubs
    stubbedLoader = getStubbedLocalResourceLoader(sandbox);
    stubbedLoader.getSchemaRegistries.resolves([TEST_LOCAL_SCHEMA_REGISTRY]);
    stubbedLoader.getSchemasForSubject.resolves(testSchemas);

    // quickpick+util stubs
    schemaVersionQuickPickStub = sandbox.stub(schemaQuickPicks, "schemaVersionQuickPick");
    getSubjectNameForStrategyStub = sandbox
      .stub(schemaSubjects, "getSubjectNameForStrategy")
      .resolves(TEST_LOCAL_SCHEMA.subject);

    // stub the WorkspaceConfiguration
    stubbedConfigs = new StubbedWorkspaceConfiguration(sandbox);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should throw an error when no Schema Registry is found", async () => {
    // no SR instances loaded
    stubbedLoader.getSchemaRegistries.resolves([]);

    await assert.rejects(
      async () => promptForSchema(TEST_LOCAL_KAFKA_TOPIC, "key", SubjectNameStrategy.TOPIC_NAME),
      { message: `No Schema Registry available for topic "${TEST_LOCAL_KAFKA_TOPIC.name}".` },
    );
    sinon.assert.calledOnce(showErrorNotificationStub);
    sinon.assert.notCalled(schemaVersionQuickPickStub);
    sinon.assert.notCalled(stubbedLoader.getSchemasForSubject);
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
    sinon.assert.notCalled(stubbedLoader.getSchemasForSubject);
  });

  it("should use schemaVersionQuickPick when `allowOlderVersions` is true", async () => {
    // allowOlderVersions setting enabled
    stubbedConfigs.stubGet(ALLOW_OLDER_SCHEMA_VERSIONS, true);
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
    stubbedConfigs.stubGet(ALLOW_OLDER_SCHEMA_VERSIONS, true);
    // user cancels the schema version quick pick
    schemaVersionQuickPickStub.resolves(undefined);

    await assert.rejects(
      async () => promptForSchema(TEST_LOCAL_KAFKA_TOPIC, "value", SubjectNameStrategy.TOPIC_NAME),
      { message: "Schema version not chosen." },
    );
    sinon.assert.calledOnce(schemaVersionQuickPickStub);
    sinon.assert.notCalled(stubbedLoader.getSchemasForSubject);
    sinon.assert.notCalled(showErrorNotificationStub);
  });

  it("should return the latest schema version when `allowOlderVersions` is false", async () => {
    stubbedLoader.getSchemasForSubject.resolves(testSchemas);

    const result = await promptForSchema(
      TEST_LOCAL_KAFKA_TOPIC,
      "value",
      SubjectNameStrategy.TOPIC_NAME,
    );

    sinon.assert.notCalled(schemaVersionQuickPickStub);
    assert.strictEqual(result, testSchemas[0]); // latest version
  });

  it("should throw an error when no schema versions are found for the subject", async () => {
    stubbedLoader.getSchemasForSubject.resolves([]);

    await assert.rejects(
      async () => promptForSchema(TEST_LOCAL_KAFKA_TOPIC, "value", SubjectNameStrategy.TOPIC_NAME),
      { message: `No schema versions found for subject "${TEST_LOCAL_SCHEMA.subject}".` },
    );
    assert.ok(showErrorNotificationStub.calledOnce);
  });
});
