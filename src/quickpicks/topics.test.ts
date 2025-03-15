import * as assert from "assert";
import sinon from "sinon";
import * as vscode from "vscode";
import {
  TEST_CCLOUD_KAFKA_CLUSTER,
  TEST_LOCAL_KAFKA_CLUSTER,
  TEST_LOCAL_KAFKA_TOPIC,
  TEST_LOCAL_SUBJECT_WITH_SCHEMAS,
} from "../../tests/unit/testResources";
import { IconNames } from "../constants";
import { ResourceLoader } from "../loaders";
import { KafkaTopic } from "../models/topic";
import { topicQuickPick } from "./topics";
import { QuickPickItemWithValue } from "./types";

describe("quickpicks/topics.ts topicQuickPick()", function () {
  let sandbox: sinon.SinonSandbox;

  let withProgressStub: sinon.SinonStub;
  let getInstanceStub: sinon.SinonStub;
  let showQuickPickStub: sinon.SinonStub;
  let showInfoStub: sinon.SinonStub;
  let executeCommandStub: sinon.SinonStub;

  let loaderStub: sinon.SinonStubbedInstance<ResourceLoader>;

  const topicWithoutSchema = TEST_LOCAL_KAFKA_TOPIC;
  const topicWithSchema = KafkaTopic.create({
    ...topicWithoutSchema,
    name: "topic-with-schema",
    hasSchema: true,
    children: [TEST_LOCAL_SUBJECT_WITH_SCHEMAS],
  });
  const testTopics: KafkaTopic[] = [topicWithSchema, topicWithoutSchema];

  beforeEach(function () {
    sandbox = sinon.createSandbox();

    // vscode stubs
    withProgressStub = sandbox.stub(vscode.window, "withProgress");
    withProgressStub.callsFake((_options, callback) => callback());
    showQuickPickStub = sandbox.stub(vscode.window, "showQuickPick");
    showInfoStub = sandbox.stub(vscode.window, "showInformationMessage").resolves();
    executeCommandStub = sandbox.stub(vscode.commands, "executeCommand").resolves();

    loaderStub = sandbox.createStubInstance(ResourceLoader);
    getInstanceStub = sandbox.stub(ResourceLoader, "getInstance").returns(loaderStub);
    // return the two test topics for most tests
    loaderStub.getTopicsForCluster.resolves(testTopics);
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("should correctly set quickpick options", async function () {
    await topicQuickPick(TEST_LOCAL_KAFKA_CLUSTER);

    sinon.assert.calledOnce(showQuickPickStub);
    const options = showQuickPickStub.firstCall.args[1];
    assert.strictEqual(options.placeHolder, "Select a topic");
    assert.strictEqual(options.ignoreFocusOut, true);
  });

  it("should display progress in the Topics view while loading", async function () {
    await topicQuickPick(TEST_CCLOUD_KAFKA_CLUSTER);

    sinon.assert.calledOnce(withProgressStub);
    const options = withProgressStub.firstCall.args[0];
    assert.strictEqual(options.location.viewId, "confluent-topics");
    assert.strictEqual(options.title, "Loading topics...");
  });

  it("should get topics from the ResourceLoader with the correct connectionId", async function () {
    await topicQuickPick(TEST_LOCAL_KAFKA_CLUSTER);

    sinon.assert.calledOnceWithExactly(getInstanceStub, TEST_LOCAL_KAFKA_CLUSTER.connectionId);
    sinon.assert.calledOnceWithExactly(
      loaderStub.getTopicsForCluster,
      TEST_LOCAL_KAFKA_CLUSTER,
      false,
    );
  });

  it("should pass forceRefresh=true to getTopicsForCluster when specified", async function () {
    await topicQuickPick(TEST_LOCAL_KAFKA_CLUSTER, true);

    sinon.assert.calledOnceWithExactly(
      loaderStub.getTopicsForCluster,
      TEST_LOCAL_KAFKA_CLUSTER,
      true,
    );
  });

  it("should show quickpick with topics and appropriate icons", async function () {
    await topicQuickPick(TEST_LOCAL_KAFKA_CLUSTER);

    sinon.assert.calledOnce(showQuickPickStub);

    const quickPickItems: QuickPickItemWithValue<KafkaTopic>[] =
      showQuickPickStub.firstCall.args[0];
    assert.strictEqual(quickPickItems.length, 2);

    // look for the two test topics without their index values since they may be sorted
    // on the way out of the loader method
    const topicItemsWithSchema: QuickPickItemWithValue<KafkaTopic>[] = quickPickItems.filter(
      (item: QuickPickItemWithValue<KafkaTopic>) => item.value!.hasSchema,
    );
    assert.strictEqual(topicItemsWithSchema.length, 1);
    assert.strictEqual(topicItemsWithSchema[0].value, topicWithSchema);
    assert.strictEqual(topicItemsWithSchema[0].label, topicWithSchema.name);
    assert.strictEqual((topicItemsWithSchema[0].iconPath as vscode.ThemeIcon).id, IconNames.TOPIC);

    const topicItemsWithoutSchema: QuickPickItemWithValue<KafkaTopic>[] = quickPickItems.filter(
      (item: QuickPickItemWithValue<KafkaTopic>) => !item.value!.hasSchema,
    );
    assert.strictEqual(topicItemsWithoutSchema.length, 1);
    assert.strictEqual(topicItemsWithoutSchema[0].value, topicWithoutSchema);
    assert.strictEqual(topicItemsWithoutSchema[0].label, topicWithoutSchema.name);
    assert.strictEqual(
      (topicItemsWithoutSchema[0].iconPath as vscode.ThemeIcon).id,
      IconNames.TOPIC_WITHOUT_SCHEMA,
    );
  });

  it("should return the selected topic", async function () {
    showQuickPickStub.resolves({
      label: testTopics[0].name,
      value: testTopics[0],
    });

    const result = await topicQuickPick(TEST_LOCAL_KAFKA_CLUSTER);

    assert.strictEqual(result, testTopics[0]);
  });

  it("should return undefined if no topic is selected", async function () {
    // user cancels the quickpick
    showQuickPickStub.resolves(undefined);

    const result = await topicQuickPick(TEST_LOCAL_KAFKA_CLUSTER);

    assert.strictEqual(result, undefined);
  });

  it("should skip the quickpick and show an info notification when no topics are found for the Kafka cluster", async function () {
    // no topics in the cluster
    loaderStub.getTopicsForCluster.resolves([]);

    const result = await topicQuickPick(TEST_CCLOUD_KAFKA_CLUSTER);

    assert.strictEqual(result, undefined);
    sinon.assert.calledOnce(showInfoStub);
    sinon.assert.calledWithExactly(
      showInfoStub,
      `No topics found for Kafka cluster "${TEST_CCLOUD_KAFKA_CLUSTER.name}".`,
      "Create Topic",
    );
    sinon.assert.notCalled(showQuickPickStub);
    sinon.assert.notCalled(executeCommandStub);
  });

  it("should allow creating a topic from the info notification when no topics are found for the Kafka cluster", async function () {
    // no topics in the cluster
    loaderStub.getTopicsForCluster.resolves([]);
    // user clicked "Create Topic" in the info notification
    showInfoStub.resolves("Create Topic");

    await topicQuickPick(TEST_LOCAL_KAFKA_CLUSTER);

    sinon.assert.calledOnce(showInfoStub);
    sinon.assert.calledWithExactly(
      showInfoStub,
      `No topics found for Kafka cluster "${TEST_LOCAL_KAFKA_CLUSTER.name}".`,
      "Create Topic",
    );
    sinon.assert.calledOnce(executeCommandStub);
    sinon.assert.calledWithExactly(
      executeCommandStub,
      "confluent.topics.create",
      TEST_LOCAL_KAFKA_CLUSTER,
    );
  });
});
