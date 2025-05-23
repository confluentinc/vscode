import * as assert from "assert";
import * as sinon from "sinon";
import { commands, ThemeIcon, window } from "vscode";
import {
  getStubbedCCloudResourceLoader,
  getStubbedDirectResourceLoader,
  getStubbedLocalResourceLoader,
  getStubbedResourceLoader,
} from "../../tests/stubs/resourceLoaders";
import {
  TEST_CCLOUD_KAFKA_CLUSTER,
  TEST_DIRECT_KAFKA_CLUSTER,
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

  let showInfoStub: sinon.SinonStub;
  let showQuickPickStub: sinon.SinonStub;
  let executeCommandStub: sinon.SinonStub;

  let stubbedLoader: sinon.SinonStubbedInstance<ResourceLoader>;

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
    showQuickPickStub = sandbox.stub(window, "showQuickPick");
    executeCommandStub = sandbox.stub(commands, "executeCommand").resolves();
    showInfoStub = sandbox.stub(window, "showInformationMessage").resolves();

    stubbedLoader = getStubbedResourceLoader(sandbox);
    // return the two test topics for most tests
    stubbedLoader.getTopicsForCluster.resolves(testTopics);
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

  it("should not pass forceRefresh=true to getTopicsForCluster by default", async function () {
    await topicQuickPick(TEST_LOCAL_KAFKA_CLUSTER);

    sinon.assert.calledOnceWithExactly(
      stubbedLoader.getTopicsForCluster,
      TEST_LOCAL_KAFKA_CLUSTER,
      false, // not force-refreshing by default
    );
  });

  it("should pass forceRefresh=true to getTopicsForCluster when specified", async function () {
    await topicQuickPick(TEST_LOCAL_KAFKA_CLUSTER, true);

    sinon.assert.calledOnceWithExactly(
      stubbedLoader.getTopicsForCluster,
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
    assert.strictEqual((topicItemsWithSchema[0].iconPath as ThemeIcon).id, IconNames.TOPIC);

    const topicItemsWithoutSchema: QuickPickItemWithValue<KafkaTopic>[] = quickPickItems.filter(
      (item: QuickPickItemWithValue<KafkaTopic>) => !item.value!.hasSchema,
    );
    assert.strictEqual(topicItemsWithoutSchema.length, 1);
    assert.strictEqual(topicItemsWithoutSchema[0].value, topicWithoutSchema);
    assert.strictEqual(topicItemsWithoutSchema[0].label, topicWithoutSchema.name);
    assert.strictEqual(
      (topicItemsWithoutSchema[0].iconPath as ThemeIcon).id,
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
    stubbedLoader.getTopicsForCluster.resolves([]);
    // user dismissed the info notification
    showInfoStub.resolves(undefined);

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
    stubbedLoader.getTopicsForCluster.resolves([]);
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

// separate test suite so we don't interfere with `stubbedLoader` in the above suite
describe("quickpicks/topics.ts topicQuickPick() ResourceLoader usage", function () {
  let sandbox: sinon.SinonSandbox;

  const testTopics: KafkaTopic[] = [TEST_LOCAL_KAFKA_TOPIC];

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    // we don't care about the actual quickpick result in these tests
    sandbox.stub(window, "showQuickPick").resolves();
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("should use the LocalResourceLoader for local clusters", async function () {
    const localLoader = getStubbedLocalResourceLoader(sandbox);
    localLoader.getTopicsForCluster.resolves(testTopics);

    await topicQuickPick(TEST_LOCAL_KAFKA_CLUSTER);

    sinon.assert.calledOnce(localLoader.getTopicsForCluster);
    sinon.assert.calledWith(localLoader.getTopicsForCluster, TEST_LOCAL_KAFKA_CLUSTER);
  });

  it("should use the CCloudResourceLoader for CCloud clusters", async function () {
    const ccloudLoader = getStubbedCCloudResourceLoader(sandbox);
    ccloudLoader.getTopicsForCluster.resolves(testTopics);

    await topicQuickPick(TEST_CCLOUD_KAFKA_CLUSTER);

    sinon.assert.calledOnce(ccloudLoader.getTopicsForCluster);
    sinon.assert.calledWith(ccloudLoader.getTopicsForCluster, TEST_CCLOUD_KAFKA_CLUSTER);
  });

  it("should use the DirectResourceLoader for direct connection clusters", async function () {
    const directLoader = getStubbedDirectResourceLoader(sandbox);
    directLoader.getTopicsForCluster.resolves(testTopics);

    await topicQuickPick(TEST_DIRECT_KAFKA_CLUSTER);

    sinon.assert.calledOnce(directLoader.getTopicsForCluster);
    sinon.assert.calledWith(directLoader.getTopicsForCluster, TEST_DIRECT_KAFKA_CLUSTER);
  });
});
