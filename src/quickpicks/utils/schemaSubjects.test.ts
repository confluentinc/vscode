import * as assert from "assert";
import sinon from "sinon";
import { commands, window, workspace } from "vscode";
import { TEST_LOCAL_SUBJECT } from "../../../tests/unit/testResources/schema";
import { TEST_LOCAL_SCHEMA_REGISTRY } from "../../../tests/unit/testResources/schemaRegistry";
import { TEST_LOCAL_KAFKA_TOPIC } from "../../../tests/unit/testResources/topic";
import { LocalResourceLoader, ResourceLoader } from "../../loaders";
import { Subject } from "../../models/schema";
import { USE_TOPIC_NAME_STRATEGY } from "../../preferences/constants";
import { SubjectNameStrategy } from "../../schemas/produceMessageSchema";
import * as schemaQuickPicks from "../schemas";
import { getSubjectNameForStrategy, getSubjectNameStrategy } from "./schemaSubjects";

describe("quickpicks/utils/schemaSubjects.ts getSubjectNameForStrategy()", () => {
  let sandbox: sinon.SinonSandbox;
  let showErrorNotificationStub: sinon.SinonStub;
  let executeCommandStub: sinon.SinonStub;
  let schemaSubjectQuickPickStub: sinon.SinonStub;

  let resourceLoaderStub: sinon.SinonStub;
  // use local loaders for these tests; no functional difference between local/CCloud/direct here
  let resourceLoader: sinon.SinonStubbedInstance<LocalResourceLoader>;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // vscode stubs
    showErrorNotificationStub = sandbox.stub(window, "showErrorMessage");
    executeCommandStub = sandbox.stub(commands, "executeCommand");

    // quickpick stubs
    schemaSubjectQuickPickStub = sandbox.stub(schemaQuickPicks, "schemaSubjectQuickPick");

    // ResourceLoader stubs
    resourceLoaderStub = sandbox.stub(ResourceLoader, "getInstance");
    resourceLoader = sandbox.createStubInstance(LocalResourceLoader);
    resourceLoaderStub.returns(resourceLoader);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it(`should return subject name for ${SubjectNameStrategy.TOPIC_NAME} strategy when subject exists`, async () => {
    resourceLoader.getSubjects.resolves([TEST_LOCAL_SUBJECT]);
    const expectedSubjectName = `${TEST_LOCAL_KAFKA_TOPIC.name}-value`;

    const result = await getSubjectNameForStrategy(
      SubjectNameStrategy.TOPIC_NAME,
      TEST_LOCAL_KAFKA_TOPIC,
      "value",
      TEST_LOCAL_SCHEMA_REGISTRY,
      resourceLoader,
    );

    assert.strictEqual(result, expectedSubjectName);
    sinon.assert.calledOnceWithExactly(resourceLoader.getSubjects, TEST_LOCAL_SCHEMA_REGISTRY);
    sinon.assert.notCalled(schemaSubjectQuickPickStub);
    sinon.assert.notCalled(showErrorNotificationStub);
  });

  it(`should throw error for ${SubjectNameStrategy.TOPIC_NAME} strategy when subject does not exist`, async () => {
    // subject that won't match our search
    const differentSubject = new Subject(
      "different-subject",
      TEST_LOCAL_SUBJECT.connectionId,
      TEST_LOCAL_SUBJECT.environmentId,
      TEST_LOCAL_SUBJECT.schemaRegistryId,
    );
    resourceLoader.getSubjects.resolves([differentSubject]);

    await assert.rejects(
      async () =>
        getSubjectNameForStrategy(
          SubjectNameStrategy.TOPIC_NAME,
          TEST_LOCAL_KAFKA_TOPIC,
          "key",
          TEST_LOCAL_SCHEMA_REGISTRY,
          resourceLoader,
        ),
      {
        message: `No "key" schema subject found for topic "${TEST_LOCAL_KAFKA_TOPIC.name}" using the ${SubjectNameStrategy.TOPIC_NAME} strategy.`,
      },
    );

    sinon.assert.calledOnce(showErrorNotificationStub);
    sinon.assert.notCalled(schemaSubjectQuickPickStub);
  });

  it(`should open settings when "Open Settings" button is clicked after no-subject-found error notification`, async () => {
    // subject that won't match our search
    const differentSubject = new Subject(
      "different-subject",
      TEST_LOCAL_SUBJECT.connectionId,
      TEST_LOCAL_SUBJECT.environmentId,
      TEST_LOCAL_SUBJECT.schemaRegistryId,
    );
    resourceLoader.getSubjects.resolves([differentSubject]);
    // user clicked the "Open Settings" button
    showErrorNotificationStub.resolves("Open Settings");

    await assert.rejects(
      async () =>
        getSubjectNameForStrategy(
          SubjectNameStrategy.TOPIC_NAME,
          TEST_LOCAL_KAFKA_TOPIC,
          "key",
          TEST_LOCAL_SCHEMA_REGISTRY,
          resourceLoader,
        ),
      {
        message: `No "key" schema subject found for topic "${TEST_LOCAL_KAFKA_TOPIC.name}" using the ${SubjectNameStrategy.TOPIC_NAME} strategy.`,
      },
    );

    sinon.assert.calledOnce(showErrorNotificationStub);
    sinon.assert.notCalled(schemaSubjectQuickPickStub);
    sinon.assert.calledOnce(executeCommandStub);
    sinon.assert.calledWithExactly(
      executeCommandStub,
      "workbench.action.openSettings",
      `@id:${USE_TOPIC_NAME_STRATEGY}`,
    );
  });

  it(`should call schemaSubjectQuickPick with a filter predicate for the ${SubjectNameStrategy.TOPIC_RECORD_NAME} strategy`, async () => {
    const subjectName = `${TEST_LOCAL_KAFKA_TOPIC.name}-custom`;
    schemaSubjectQuickPickStub.resolves(subjectName);

    const result = await getSubjectNameForStrategy(
      SubjectNameStrategy.TOPIC_RECORD_NAME,
      TEST_LOCAL_KAFKA_TOPIC,
      "value",
      TEST_LOCAL_SCHEMA_REGISTRY,
      resourceLoader,
    );

    assert.strictEqual(result, subjectName);
    sinon.assert.calledOnce(schemaSubjectQuickPickStub);
    const call = schemaSubjectQuickPickStub.getCall(0);
    assert.strictEqual(call.args[0], TEST_LOCAL_SCHEMA_REGISTRY);
    assert.strictEqual(call.args[1], false);
    assert.strictEqual(call.args[2], `Producing to ${TEST_LOCAL_KAFKA_TOPIC.name}: value schema`);

    // Verify the filter function properly filters by topic name prefix
    const filterFn = call.args[3];
    assert.strictEqual(typeof filterFn, "function");
    assert.strictEqual(filterFn({ name: `${TEST_LOCAL_KAFKA_TOPIC.name}-something` }), true);
    assert.strictEqual(filterFn({ name: "unrelated-subject" }), false);
  });

  it(`should call the schemaSubjectQuickPick without a filter predicate for ${SubjectNameStrategy.RECORD_NAME} strategy`, async () => {
    const subjectName = "custom-subject";
    schemaSubjectQuickPickStub.resolves(subjectName);

    const result = await getSubjectNameForStrategy(
      SubjectNameStrategy.RECORD_NAME,
      TEST_LOCAL_KAFKA_TOPIC,
      "key",
      TEST_LOCAL_SCHEMA_REGISTRY,
      resourceLoader,
    );

    assert.strictEqual(result, subjectName);
    sinon.assert.calledOnce(schemaSubjectQuickPickStub);
    const call = schemaSubjectQuickPickStub.getCall(0);
    assert.strictEqual(call.args[0], TEST_LOCAL_SCHEMA_REGISTRY);
    assert.strictEqual(call.args[1], false);
    assert.strictEqual(call.args[2], `Producing to ${TEST_LOCAL_KAFKA_TOPIC.name}: key schema`);
    // no filter function should be provided for RECORD_NAME
    assert.strictEqual(call.args[3], undefined);
  });

  it("should return undefined when schemaSubjectQuickPick returns undefined", async () => {
    schemaSubjectQuickPickStub.resolves(undefined);

    const result = await getSubjectNameForStrategy(
      SubjectNameStrategy.RECORD_NAME,
      TEST_LOCAL_KAFKA_TOPIC,
      "value",
      TEST_LOCAL_SCHEMA_REGISTRY,
      resourceLoaderStub as unknown as ResourceLoader,
    );

    assert.strictEqual(result, undefined);
    sinon.assert.calledOnce(schemaSubjectQuickPickStub);
  });

  it("should throw an error and show a notification if the subject isn't found", async () => {
    resourceLoader.getSubjects.resolves([]);

    await assert.rejects(
      async () =>
        getSubjectNameForStrategy(
          SubjectNameStrategy.TOPIC_NAME,
          TEST_LOCAL_KAFKA_TOPIC,
          "key",
          TEST_LOCAL_SCHEMA_REGISTRY,
          resourceLoader,
        ),
      {
        message: `No "key" schema subject found for topic "${TEST_LOCAL_KAFKA_TOPIC.name}" using the ${SubjectNameStrategy.TOPIC_NAME} strategy.`,
      },
    );

    // Assert
    sinon.assert.calledOnce(showErrorNotificationStub);
    sinon.assert.notCalled(schemaSubjectQuickPickStub);
  });
});

describe("quickpicks/utils/schemaSubjects.ts getSubjectNameStrategy()", () => {
  let sandbox: sinon.SinonSandbox;

  let getConfigurationStub: sinon.SinonStub;

  let subjectNameStrategyQuickPickStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // vscode stubs
    getConfigurationStub = sandbox.stub(workspace, "getConfiguration");
    getConfigurationStub.returns({
      get: sandbox.stub(),
    });

    // quickpick stubs
    subjectNameStrategyQuickPickStub = sandbox.stub(
      schemaQuickPicks,
      "subjectNameStrategyQuickPick",
    );
  });

  afterEach(() => {
    sandbox.restore();
  });

  it(`should return ${SubjectNameStrategy.TOPIC_NAME} strategy when "${USE_TOPIC_NAME_STRATEGY}" is enabled`, async () => {
    // `useTopicNameStrategy` enabled
    getConfigurationStub.returns({
      get: sandbox.stub().withArgs(USE_TOPIC_NAME_STRATEGY).returns(true),
    });

    const result = await getSubjectNameStrategy(TEST_LOCAL_KAFKA_TOPIC, "key");

    assert.strictEqual(result, SubjectNameStrategy.TOPIC_NAME);
    sinon.assert.notCalled(subjectNameStrategyQuickPickStub);
  });

  it(`should prompt for strategy when "${USE_TOPIC_NAME_STRATEGY}" is disabled`, async () => {
    // `useTopicNameStrategy` disabled
    getConfigurationStub.returns({
      get: sandbox.stub().withArgs(USE_TOPIC_NAME_STRATEGY).returns(false),
    });
    subjectNameStrategyQuickPickStub.resolves(SubjectNameStrategy.RECORD_NAME);

    const result = await getSubjectNameStrategy(TEST_LOCAL_KAFKA_TOPIC, "key");

    assert.strictEqual(result, SubjectNameStrategy.RECORD_NAME);
    sinon.assert.calledOnceWithExactly(
      subjectNameStrategyQuickPickStub,
      TEST_LOCAL_KAFKA_TOPIC,
      "key",
    );
  });

  it("should return `undefined` when subjectNameStrategyQuickPick returns undefined", async () => {
    // `useTopicNameStrategy` disabled
    getConfigurationStub.returns({
      get: sandbox.stub().withArgs(USE_TOPIC_NAME_STRATEGY).returns(false),
    });
    subjectNameStrategyQuickPickStub.resolves(undefined);

    const result = await getSubjectNameStrategy(TEST_LOCAL_KAFKA_TOPIC, "key");

    assert.strictEqual(result, undefined);
    sinon.assert.calledOnce(subjectNameStrategyQuickPickStub);
  });
});
