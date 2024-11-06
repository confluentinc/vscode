import * as assert from "assert";
import * as sinon from "sinon";
import { commands, window, workspace } from "vscode";
import {
  TEST_CANCELLATION_TOKEN,
  TEST_KAFKA_CONTAINERS,
} from "../../../tests/unit/testResources/docker";
import { getExtensionContext } from "../../../tests/unit/testUtils";
import { ContainerCreateResponse, ContainerInspectResponse } from "../../clients/docker";
import {
  LOCAL_DOCKER_SOCKET_PATH,
  LOCAL_KAFKA_IMAGE,
  LOCAL_KAFKA_IMAGE_TAG,
} from "../../preferences/constants";
import { DEFAULT_UNIX_SOCKET_PATH } from "../configs";
import { DEFAULT_KAFKA_IMAGE_REPO, DEFAULT_KAFKA_IMAGE_TAG } from "../constants";
import * as dockerContainers from "../containers";
import { ConfluentPlatformSchemaRegistryWorkflow } from "./cp-schema-registry";

describe("docker/workflows/cp-schema-registry.ts ConfluentPlatformSchemaRegistryWorkflow", () => {
  let sandbox: sinon.SinonSandbox;

  // vscode stubs
  let showErrorMessageStub: sinon.SinonStub;
  let executeCommandStub: sinon.SinonStub;
  let getConfigurationStub: sinon.SinonStub;

  // docker/containers.ts wrapper function stubs
  let createContainerStub: sinon.SinonStub;
  let getContainersForImageStub: sinon.SinonStub;
  let getContainerStub: sinon.SinonStub;

  let workflow: ConfluentPlatformSchemaRegistryWorkflow;
  // base class stubs
  let checkForImageStub: sinon.SinonStub;
  let handleExistingContainersStub: sinon.SinonStub;
  let showErrorNotificationStub: sinon.SinonStub;
  let fetchAndFilterKafkaContainersStub: sinon.SinonStub;
  let startContainerStub: sinon.SinonStub;
  let stopContainerStub: sinon.SinonStub;
  let waitForLocalResourceEventChangeStub: sinon.SinonStub;

  let updateLocalSchemaRegistryURI: sinon.SinonStub;

  before(async () => {
    await getExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    showErrorMessageStub = sandbox.stub(window, "showErrorMessage").resolves();
    executeCommandStub = sandbox.stub(commands, "executeCommand").resolves();
    // this should probably live in a separate test helper file
    getConfigurationStub = sandbox.stub(workspace, "getConfiguration");
    getConfigurationStub.returns({
      get: sandbox.stub().callsFake((key: string) => {
        switch (key) {
          case LOCAL_KAFKA_IMAGE:
            return DEFAULT_KAFKA_IMAGE_REPO;
          case LOCAL_KAFKA_IMAGE_TAG:
            return DEFAULT_KAFKA_IMAGE_TAG;
          case LOCAL_DOCKER_SOCKET_PATH:
            return DEFAULT_UNIX_SOCKET_PATH;
        }
      }),
    });

    // assume no running containers matching this workflow image for most tests
    getContainersForImageStub = sandbox
      .stub(dockerContainers, "getContainersForImage")
      .resolves([]);
    getContainerStub = sandbox.stub(dockerContainers, "getContainer");

    workflow = ConfluentPlatformSchemaRegistryWorkflow.getInstance();

    checkForImageStub = sandbox.stub(workflow, "checkForImage").resolves();
    handleExistingContainersStub = sandbox.stub(workflow, "handleExistingContainers").resolves();
    showErrorNotificationStub = sandbox.stub(workflow, "showErrorNotification").resolves();
    // assume we have Kafka containers to work off of for most tests
    fetchAndFilterKafkaContainersStub = sandbox
      .stub(workflow, "fetchAndFilterKafkaContainers")
      .resolves(TEST_KAFKA_CONTAINERS);
    // assume the container is created successfully for most tests
    const fakeCreatedContainer: ContainerCreateResponse = { Id: "1", Warnings: [] };
    createContainerStub = sandbox
      .stub(dockerContainers, "createContainer")
      .resolves(fakeCreatedContainer);
    // assume the container starts successfully for most tests
    const fakeStartedContainer: ContainerInspectResponse = { Id: "1" };
    startContainerStub = sandbox.stub(workflow, "startContainer").resolves(fakeStartedContainer);
    // assume the container stops successfully for most tests
    stopContainerStub = sandbox.stub(workflow, "stopContainer").resolves();
    // don't block on waiting for the event to resolve for most tests
    waitForLocalResourceEventChangeStub = sandbox
      .stub(workflow, "waitForLocalResourceEventChange")
      .resolves();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it(".imageRepo should return the correct image repository for this workflow", () => {
    // making sure the getter method is working as expected against the static property
    assert.equal(workflow.imageRepo, ConfluentPlatformSchemaRegistryWorkflow.imageRepo);
  });

  it("start() should create and start Schema Registry container", async () => {
    getContainersForImageStub.resolves([]);
    createContainerStub.resolves({ Id: "1" });

    await workflow.start(TEST_CANCELLATION_TOKEN);

    // happy path: no existing containers, Kafka container(s) exist to work off of
    assert.ok(checkForImageStub.calledOnce);

    assert.ok(getContainersForImageStub.calledOnce); // twice if fetchAndFilterKafkaContainersStub is not stubbed
    assert.ok(handleExistingContainersStub.notCalled);

    assert.ok(fetchAndFilterKafkaContainersStub.calledOnce);

    assert.ok(createContainerStub.calledOnce);
    assert.ok(startContainerStub.calledOnce);

    assert.ok(waitForLocalResourceEventChangeStub.calledOnce);
  });

  it("start() should handle existing containers and not create new ones", async () => {
    const fakeContainers = [{ Id: "1", Names: ["container1"] }];
    getContainersForImageStub.resolves(fakeContainers);

    await workflow.start(TEST_CANCELLATION_TOKEN);

    assert.ok(checkForImageStub.calledOnce);

    assert.ok(getContainersForImageStub.calledOnce);
    assert.ok(handleExistingContainersStub.calledOnceWith(fakeContainers));
    // bailing here

    assert.ok(fetchAndFilterKafkaContainersStub.notCalled);

    assert.ok(createContainerStub.notCalled);
    assert.ok(startContainerStub.notCalled);

    assert.ok(waitForLocalResourceEventChangeStub.notCalled);
  });

  it("start() should exit early when no Kafka containers are found", async () => {
    fetchAndFilterKafkaContainersStub.resolves([]);

    await workflow.start(TEST_CANCELLATION_TOKEN);

    assert.ok(checkForImageStub.calledOnce);

    assert.ok(getContainersForImageStub.calledOnce);
    assert.ok(handleExistingContainersStub.notCalled);

    assert.ok(fetchAndFilterKafkaContainersStub.calledOnce);
    assert.ok(showErrorMessageStub.calledOnce);
    // bailing here

    assert.ok(createContainerStub.notCalled);
    assert.ok(startContainerStub.notCalled);

    assert.ok(waitForLocalResourceEventChangeStub.notCalled);
  });

  it("start() should exit early and show an error notification if a container fails to be created", async () => {
    createContainerStub.rejects(new Error("uh oh"));

    await workflow.start(TEST_CANCELLATION_TOKEN);

    assert.ok(checkForImageStub.calledOnce);

    assert.ok(getContainersForImageStub.calledOnce);
    assert.ok(handleExistingContainersStub.notCalled);

    assert.ok(fetchAndFilterKafkaContainersStub.calledOnce);
    assert.ok(showErrorMessageStub.notCalled);

    assert.ok(createContainerStub.calledOnce);
    // bailing here
    assert.ok(startContainerStub.notCalled);

    assert.ok(waitForLocalResourceEventChangeStub.notCalled);
  });

  it("start() should exit early and if a container fails to start", async () => {
    startContainerStub.resolves(undefined);

    await workflow.start(TEST_CANCELLATION_TOKEN);

    assert.ok(checkForImageStub.calledOnce);

    assert.ok(getContainersForImageStub.calledOnce);
    assert.ok(handleExistingContainersStub.notCalled);

    assert.ok(fetchAndFilterKafkaContainersStub.calledOnce);

    assert.ok(createContainerStub.calledOnce);
    assert.ok(startContainerStub.calledOnce);
    // notification tested in base.test.ts as part of .startContainer() tests

    assert.ok(waitForLocalResourceEventChangeStub.notCalled);
  });

  it("stop() should stop Schema Registry container", async () => {
    const fakeContainers = [{ Id: "1", Names: ["container1"] }];
    getContainersForImageStub.resolves(fakeContainers);

    await workflow.stop(TEST_CANCELLATION_TOKEN);

    assert.ok(getContainersForImageStub.calledOnce);
    assert.ok(stopContainerStub.calledOnce);
    assert.ok(waitForLocalResourceEventChangeStub.calledOnce);
  });

  it("stop() should exit early if there are no running Schema Registry containers", async () => {
    getContainersForImageStub.resolves([]);

    await workflow.stop(TEST_CANCELLATION_TOKEN);

    assert.ok(getContainersForImageStub.calledOnce);
    assert.ok(stopContainerStub.notCalled);
    assert.ok(waitForLocalResourceEventChangeStub.notCalled);
  });

  // TODO: ADD MORE HERE
  // workflow.fetchAndFilterKafkaContainers()

  it("fetchAndFilterKafkaContainers() should return Kafka containers", async () => {
    getContainersForImageStub.resolves(TEST_KAFKA_CONTAINERS);

    const kafkaContainers = await workflow.fetchAndFilterKafkaContainers();

    assert.deepEqual(kafkaContainers, TEST_KAFKA_CONTAINERS);
  });
});

// TODO: ADD MORE HERE
// determineKafkaDockerNetwork()
// determineKafkaBootstrapServers()
