import * as assert from "assert";
import * as sinon from "sinon";
import { window, workspace } from "vscode";
import { ContainerInspectResponse, ContainerSummary, ResponseError } from "../../clients/docker";
import { Logger } from "../../logging";
import { LOCAL_KAFKA_IMAGE } from "../../preferences/constants";
import * as dockerContainers from "../containers";
import * as dockerImages from "../images";
import { LocalResourceContainer, LocalResourceWorkflow } from "./base";
import { ConfluentLocalWorkflow } from "./confluent-local";
import { registerLocalResourceWorkflows } from "./workflowInitialization";

class TestWorkflow extends LocalResourceWorkflow {
  protected logger = new Logger("test");
  resourceKind = "test";

  async start() {}
  async stop() {}
  async waitForLocalResourceEventChange() {}
}

describe("docker/workflows/base.ts LocalResourceWorkflow base methods/properties", () => {
  let sandbox: sinon.SinonSandbox;

  // vscode stubs
  let showErrorMessageStub: sinon.SinonStub;

  // docker/containers.ts+images.ts wrapper function stubs
  let getContainerStub: sinon.SinonStub;
  let startContainerStub: sinon.SinonStub;
  let restartContainerStub: sinon.SinonStub;
  let imageExistsStub: sinon.SinonStub;
  let pullImageStub: sinon.SinonStub;

  let workflow: TestWorkflow;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    showErrorMessageStub = sandbox.stub(window, "showErrorMessage").resolves();

    getContainerStub = sandbox.stub(dockerContainers, "getContainer");
    startContainerStub = sandbox.stub(dockerContainers, "startContainer");
    restartContainerStub = sandbox.stub(dockerContainers, "restartContainer");
    imageExistsStub = sandbox.stub(dockerImages, "imageExists");
    pullImageStub = sandbox.stub(dockerImages, "pullImage");

    workflow = new TestWorkflow();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it(".imageRepoTag should return the correct .imageRepo+.imageTag string", () => {
    (TestWorkflow as any).imageRepo = "repo";
    workflow.imageTag = "latest";

    assert.strictEqual(workflow.imageRepoTag, "repo:latest");
  });

  it("checkForImage() should check for image and pull if it does not exist", async () => {
    imageExistsStub.resolves(false);
    pullImageStub.resolves();

    await workflow["checkForImage"]("repo", "tag");

    assert.ok(imageExistsStub.calledOnceWith("repo", "tag"));
    assert.ok(pullImageStub.calledOnceWith("repo", "tag"));
  });

  it("checkForImage() should not pull image if it already exists", async () => {
    imageExistsStub.resolves(true);

    await workflow["checkForImage"]("repo", "tag");

    assert.ok(imageExistsStub.calledOnceWith("repo", "tag"));
    assert.ok(pullImageStub.notCalled);
  });

  it("handleExistingContainers() should handle an existing container and automatically start it if it isn't running", async () => {
    const workflowStartContainerStub = sandbox.stub(workflow, "startContainer");
    const fakeContainers: ContainerSummary[] = [
      { Id: "1", Names: ["/container1"], Image: "image1", State: "exited" },
    ];

    await workflow.handleExistingContainers(fakeContainers);

    assert.ok(
      workflowStartContainerStub.calledOnceWith({
        id: fakeContainers[0].Id!,
        name: fakeContainers[0].Names![0],
      }),
    );
  });

  it("handleExistingContainers() should handle multiple existing containers and automatically start them all", async () => {
    const workflowStartContainerStub = sandbox.stub(workflow, "startContainer");
    const fakeContainers: ContainerSummary[] = [
      { Id: "1", Names: ["/container1"], Image: "image1", State: "exited" },
      { Id: "2", Names: ["/container2"], Image: "image1", State: "exited" },
    ];

    await workflow.handleExistingContainers(fakeContainers);

    assert.ok(
      workflowStartContainerStub.calledTwice,
      `workflow startContainer() called ${workflowStartContainerStub.callCount} time(s) with args: ${JSON.stringify(workflowStartContainerStub.args, null, 2)}`,
    );
    assert.ok(
      workflowStartContainerStub.calledWith({
        id: fakeContainers[0].Id!,
        name: fakeContainers[0].Names![0],
      }),
    );
    assert.ok(
      workflowStartContainerStub.calledWith({
        id: fakeContainers[1].Id!,
        name: fakeContainers[1].Names![0],
      }),
    );
  });

  it("handleExistingContainers() should handle 'running' containers auto-restart them", async () => {
    const fakeContainers: ContainerSummary[] = [
      { Id: "1", Names: ["/container1"], Image: "image1", State: "running" },
    ];

    await workflow.handleExistingContainers(fakeContainers);

    assert.ok(restartContainerStub.calledOnceWith(fakeContainers[0].Id!));
  });

  it("startContainer() should start a container and return its inspect response", async () => {
    const fakeContainer: LocalResourceContainer = { id: "1", name: "test-container" };
    const fakeResponse: ContainerInspectResponse = { Id: "1" };
    startContainerStub.resolves();
    getContainerStub.resolves(fakeResponse);

    const result = await workflow.startContainer(fakeContainer);

    assert.strictEqual(result, fakeResponse);
    assert.ok(startContainerStub.calledOnceWith(fakeContainer.id));
    assert.ok(getContainerStub.calledOnceWith(fakeContainer.id));
    assert.ok(showErrorMessageStub.notCalled);
  });

  it("startContainer() should return nothing and show an error notification for port-in-use ResponseErrors", async () => {
    const fakeContainer: LocalResourceContainer = { id: "1", name: "test-container" };
    const fakeError = new ResponseError(
      new Response(
        JSON.stringify({ message: "Bind for 0.0.0.0:8082 failed: port is already allocated" }),
        {
          status: 500,
          statusText: "Internal Server Error",
        },
      ),
    );
    startContainerStub.rejects(fakeError);

    const result = await workflow.startContainer(fakeContainer);

    assert.strictEqual(result, undefined);
    assert.ok(startContainerStub.calledOnceWith(fakeContainer.id));
    assert.ok(getContainerStub.notCalled);
    assert.ok(
      showErrorMessageStub.calledOnceWith(
        'Failed to start test container "test-container": Port 8082 is already in use.',
      ),
      `showErrorMessageStub.args: ${showErrorMessageStub.args}`,
    );
  });

  it("startContainer() should return nothing and display non-ResponseError error messages in an error notification", async () => {
    const fakeContainer: LocalResourceContainer = { id: "1", name: "test-container" };
    const fakeError = new Error("uh oh");
    startContainerStub.rejects(fakeError);

    const result = await workflow.startContainer(fakeContainer);

    assert.strictEqual(result, undefined);
    assert.ok(startContainerStub.calledOnceWith(fakeContainer.id));
    assert.ok(getContainerStub.notCalled);
    assert.ok(
      showErrorMessageStub.calledOnceWith('Failed to start test container "test-container": uh oh'),
    );
  });
});

describe("docker/workflows/index.ts LocalResourceWorkflow registry", () => {
  let sandbox: sinon.SinonSandbox;

  // vscode stubs
  let showErrorMessageStub: sinon.SinonStub;
  let getConfigurationStub: sinon.SinonStub;

  before(() => {
    registerLocalResourceWorkflows();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    showErrorMessageStub = sandbox.stub(window, "showErrorMessage").resolves();
    getConfigurationStub = sandbox.stub(workspace, "getConfiguration");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it(`getKafkaWorkflow() should show an error notification and throw an error if no workflow matches the "${LOCAL_KAFKA_IMAGE}" config`, async () => {
    const unsupportedImageRepo = "unsupported/image-name";
    getConfigurationStub.returns({
      get: sandbox.stub().withArgs(LOCAL_KAFKA_IMAGE).returns(unsupportedImageRepo),
    });

    assert.throws(
      LocalResourceWorkflow.getKafkaWorkflow,
      new Error(`Unsupported Kafka image repo: ${unsupportedImageRepo}`),
    );
    assert.ok(showErrorMessageStub.calledOnce);
  });

  it(`getKafkaWorkflow() should return a ConfluentLocalWorkflow instance for the correct "${LOCAL_KAFKA_IMAGE}" config`, async () => {
    getConfigurationStub.returns({
      get: sandbox.stub().withArgs(LOCAL_KAFKA_IMAGE).returns(ConfluentLocalWorkflow.imageRepo),
    });

    const workflow = LocalResourceWorkflow.getKafkaWorkflow();

    assert.ok(workflow instanceof ConfluentLocalWorkflow);
  });

  it(`getSchemaRegistryWorkflow() should show an error notification and throw an error if no workflow matches the "${LOCAL_KAFKA_IMAGE}" config`, async () => {
    const unsupportedImageRepo = "unsupported/image-name";
    getConfigurationStub.returns({
      get: sandbox.stub().withArgs(LOCAL_KAFKA_IMAGE).returns(unsupportedImageRepo),
    });

    assert.throws(
      LocalResourceWorkflow.getSchemaRegistryWorkflow,
      new Error(`Unsupported Schema Registry image repo: ${unsupportedImageRepo}`),
    );
    assert.ok(showErrorMessageStub.calledOnce);
  });

  it(`getSchemaRegistryWorkflow() should return a ConfluentLocalWorkflow instance for the correct "${LOCAL_KAFKA_IMAGE}" config`, async () => {
    getConfigurationStub.returns({
      get: sandbox.stub().withArgs(LOCAL_KAFKA_IMAGE).returns(ConfluentLocalWorkflow.imageRepo),
    });

    const workflow = LocalResourceWorkflow.getSchemaRegistryWorkflow();

    assert.ok(workflow instanceof ConfluentLocalWorkflow);
  });
});
