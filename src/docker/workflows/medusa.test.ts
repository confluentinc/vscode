import * as assert from "assert";
import * as sinon from "sinon";
import { StubbedWorkspaceConfiguration } from "../../../tests/stubs/workspaceConfiguration";
import { TEST_CANCELLATION_TOKEN } from "../../../tests/unit/testResources/docker";
import { getTestExtensionContext } from "../../../tests/unit/testUtils";
import {
  ContainerCreateResponse,
  ContainerInspectResponse,
  ContainerSummary,
} from "../../clients/docker";
import { LOCAL_MEDUSA_INTERNAL_PORT } from "../../constants";
import { localMedusaConnected } from "../../emitters";
import {
  LOCAL_DOCKER_SOCKET_PATH,
  LOCAL_MEDUSA_IMAGE_TAG,
} from "../../extensionSettings/constants";
import * as notifications from "../../notifications";
import { DEFAULT_UNIX_SOCKET_PATH } from "../configs";
import * as dockerContainers from "../containers";
import * as dockerNetworks from "../networks";
import * as ports from "../ports";
import { LocalResourceContainer } from "./base";
import { CONTAINER_NAME, MedusaWorkflow } from "./medusa";
import { registerLocalResourceWorkflows } from "./workflowInitialization";

describe("docker/workflows/medusa.ts MedusaWorkflow", () => {
  let sandbox: sinon.SinonSandbox;

  // vscode stubs
  let stubbedConfigs: StubbedWorkspaceConfiguration;

  // docker/containers.ts+networks.ts wrapper function stubs
  let createContainerStub: sinon.SinonStub;
  let getContainersForImageStub: sinon.SinonStub;
  let getContainerStub: sinon.SinonStub;
  let waitForServiceHealthCheckStub: sinon.SinonStub;
  let createNetworkStub: sinon.SinonStub;
  let findFreePortStub: sinon.SinonStub;

  let workflow: MedusaWorkflow;
  // base class stubs
  let checkForImageStub: sinon.SinonStub;
  let handleExistingContainersStub: sinon.SinonStub;
  let showErrorNotificationStub: sinon.SinonStub;
  let startContainerStub: sinon.SinonStub;
  let stopContainerStub: sinon.SinonStub;
  let waitForLocalResourceEventChangeStub: sinon.SinonStub;

  before(async () => {
    registerLocalResourceWorkflows();
    await getTestExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    stubbedConfigs = new StubbedWorkspaceConfiguration(sandbox);
    stubbedConfigs.stubGet(LOCAL_DOCKER_SOCKET_PATH, DEFAULT_UNIX_SOCKET_PATH);

    // assume no running containers matching this workflow image for most tests
    getContainersForImageStub = sandbox
      .stub(dockerContainers, "getContainersForImage")
      .resolves([]);
    getContainerStub = sandbox.stub(dockerContainers, "getContainer");
    waitForServiceHealthCheckStub = sandbox.stub(dockerContainers, "waitForServiceHealthCheck");
    createNetworkStub = sandbox.stub(dockerNetworks, "createNetwork");
    findFreePortStub = sandbox.stub(ports, "findFreePort").resolves(8083);

    workflow = MedusaWorkflow.getInstance();

    checkForImageStub = sandbox.stub(workflow, "checkForImage").resolves();
    handleExistingContainersStub = sandbox.stub(workflow, "handleExistingContainers").resolves();
    showErrorNotificationStub = sandbox
      .stub(notifications, "showErrorNotificationWithButtons")
      .resolves();
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
    assert.equal(workflow.imageRepo, MedusaWorkflow.imageRepo);
  });

  it("start() should get the imageTag from workspace configuration", async () => {
    const customTag = "1.0.0";
    stubbedConfigs.stubGet(LOCAL_MEDUSA_IMAGE_TAG, customTag);

    await workflow.start(TEST_CANCELLATION_TOKEN);

    // just check imageTag; other tests check the rest
    assert.strictEqual(workflow.imageTag, customTag);
  });

  it("start() should create and start Medusa container", async () => {
    createNetworkStub.resolves();
    createContainerStub.resolves({ Id: "1" } as ContainerCreateResponse);

    await workflow.start(TEST_CANCELLATION_TOKEN);

    // happy path: no existing containers
    assert.ok(checkForImageStub.calledOnce);

    assert.ok(getContainersForImageStub.calledOnce);
    assert.ok(handleExistingContainersStub.notCalled);

    assert.ok(createNetworkStub.calledOnce);

    assert.ok(createContainerStub.calledOnce);
    assert.ok(startContainerStub.calledOnce);

    assert.ok(waitForLocalResourceEventChangeStub.calledOnce);
  });

  it("start() should handle existing containers and not create new ones", async () => {
    const fakeContainers: ContainerSummary[] = [{ Id: "1", Names: ["container1"] }];
    getContainersForImageStub.resolves(fakeContainers);

    await workflow.start(TEST_CANCELLATION_TOKEN);

    assert.ok(checkForImageStub.calledOnce);

    assert.ok(getContainersForImageStub.calledOnce);
    assert.ok(handleExistingContainersStub.calledOnceWith(fakeContainers));

    assert.ok(createNetworkStub.notCalled);

    assert.ok(createContainerStub.notCalled);
    assert.ok(startContainerStub.notCalled);

    assert.ok(waitForLocalResourceEventChangeStub.notCalled);
  });

  it("start() should exit early and show an error notification if a container fails to be created", async () => {
    createContainerStub.rejects(new Error("AHHH!"));

    await workflow.start(TEST_CANCELLATION_TOKEN);

    assert.ok(checkForImageStub.calledOnce);

    assert.ok(getContainersForImageStub.calledOnce);
    assert.ok(handleExistingContainersStub.notCalled);

    assert.ok(createNetworkStub.calledOnce);

    assert.ok(createContainerStub.calledOnce);
    assert.ok(showErrorNotificationStub.calledOnce);
    assert.ok(startContainerStub.notCalled);

    assert.ok(waitForLocalResourceEventChangeStub.notCalled);
  });

  it("start() should exit early if a container fails to start", async () => {
    startContainerStub.resolves(undefined);

    await workflow.start(TEST_CANCELLATION_TOKEN);

    assert.ok(checkForImageStub.calledOnce);

    assert.ok(getContainersForImageStub.calledOnce);
    assert.ok(handleExistingContainersStub.notCalled);

    assert.ok(createNetworkStub.calledOnce);

    assert.ok(createContainerStub.calledOnce);
    assert.ok(startContainerStub.calledOnce);
    // notification tested in base.test.ts as part of .startContainer() tests

    assert.ok(waitForLocalResourceEventChangeStub.notCalled);
  });

  it("stop() should get the imageTag from workspace configuration", async () => {
    const customTag = "1.0.0";
    stubbedConfigs.stubGet(LOCAL_MEDUSA_IMAGE_TAG, customTag);

    await workflow.stop(TEST_CANCELLATION_TOKEN);

    // just check imageTag; other tests check the rest
    assert.strictEqual(workflow.imageTag, customTag);
  });

  it("stop() should stop a Medusa container", async () => {
    const containerId = "1";
    // the container name will likely have a leading slash
    const containerName = "/container1";
    const fakeContainers: ContainerSummary[] = [{ Id: containerId, Names: [containerName] }];
    getContainersForImageStub.resolves(fakeContainers);

    await workflow.stop(TEST_CANCELLATION_TOKEN);

    assert.ok(getContainersForImageStub.calledOnce);
    assert.ok(stopContainerStub.calledOnceWith({ id: containerId, name: containerName }));
    assert.ok(waitForLocalResourceEventChangeStub.calledOnce);
  });

  it("stop() should exit early if there are no running Medusa containers", async () => {
    getContainersForImageStub.resolves([]);

    await workflow.stop(TEST_CANCELLATION_TOKEN);

    assert.ok(getContainersForImageStub.calledOnce);
    assert.ok(stopContainerStub.notCalled);
    assert.ok(waitForLocalResourceEventChangeStub.notCalled);
  });

  it("waitForLocalResourceEventChange() should resolve when the localMedusaConnected event is emitted", async () => {
    const promise = workflow.waitForLocalResourceEventChange();
    localMedusaConnected.fire(true);
    await assert.doesNotReject(promise);
  });

  it("createMedusaContainer() should create a Medusa container with the correct configuration", async () => {
    const fakeResponse: ContainerCreateResponse = { Id: "1", Warnings: [] };
    createContainerStub.resolves(fakeResponse);

    const hostPort = 8083;
    findFreePortStub.resolves(hostPort);

    const result: LocalResourceContainer | undefined = await workflow.createMedusaContainer();

    assert.ok(result);
    assert.equal(result.id, "1");
    assert.equal(result.name, CONTAINER_NAME);
    assert.ok(createContainerStub.calledOnce);
    assert.ok(
      createContainerStub.calledWith(workflow.imageRepo, workflow.imageTag, {
        body: {
          Image: workflow.imageRepoTag,
          Hostname: CONTAINER_NAME,
          ExposedPorts: { [`${LOCAL_MEDUSA_INTERNAL_PORT}/tcp`]: {} },
          HostConfig: {
            NetworkMode: workflow.networkName,
            PortBindings: {
              [`${LOCAL_MEDUSA_INTERNAL_PORT}/tcp`]: [
                { HostIp: "0.0.0.0", HostPort: hostPort.toString() },
              ],
            },
          },
          Env: [],
          Tty: false,
        },
        name: CONTAINER_NAME,
      }),
      `createContainerStub called with: ${JSON.stringify(createContainerStub.args, null, 2)}`,
    );
  });

  it("createMedusaContainer() should use a free port for host binding", async () => {
    const fakeResponse: ContainerCreateResponse = { Id: "1", Warnings: [] };
    createContainerStub.resolves(fakeResponse);

    const expectedPort = 8084;
    findFreePortStub.resolves(expectedPort);

    await workflow.createMedusaContainer();

    assert.ok(findFreePortStub.calledOnce);
    assert.ok(createContainerStub.calledOnce);

    // Verify the port was used in the HostConfig
    const createArgs = createContainerStub.firstCall.args[2];
    const hostConfig = createArgs.body.HostConfig;
    assert.deepStrictEqual(hostConfig.PortBindings[`${LOCAL_MEDUSA_INTERNAL_PORT}/tcp`], [
      { HostIp: "0.0.0.0", HostPort: expectedPort.toString() },
    ]);
  });

  describe("waitForReadiness()", () => {
    it("should return true when health check succeeds", async () => {
      const mockContainer: ContainerInspectResponse = {
        Id: "test-container-id",
        HostConfig: {
          PortBindings: {
            "8082/tcp": [{ HostPort: "51475" }],
          },
        },
      };
      getContainerStub.resolves(mockContainer);
      waitForServiceHealthCheckStub.resolves(true);

      const result = await workflow.waitForReadiness("test-container-id");

      assert.strictEqual(result, true);
      assert.ok(getContainerStub.calledOnceWith("test-container-id"));
      assert.ok(waitForServiceHealthCheckStub.calledOnce);
      assert.ok(
        waitForServiceHealthCheckStub.calledWith("51475", "/v1/generators/categories", "Medusa"),
      );
    });

    it("should return false when health check fails", async () => {
      const mockContainer: ContainerInspectResponse = {
        Id: "test-container-id",
        HostConfig: {
          PortBindings: {
            "8082/tcp": [{ HostPort: "51475" }],
          },
        },
      };
      getContainerStub.resolves(mockContainer);
      waitForServiceHealthCheckStub.resolves(false);

      const result = await workflow.waitForReadiness("test-container-id");

      assert.strictEqual(result, false);
      assert.ok(getContainerStub.calledOnceWith("test-container-id"));
      assert.ok(waitForServiceHealthCheckStub.calledOnce);
      assert.ok(
        waitForServiceHealthCheckStub.calledWith("51475", "/v1/generators/categories", "Medusa"),
      );
    });
  });
});
