import * as assert from "assert";
import * as sinon from "sinon";
import { window } from "vscode";
import { ContainerInspectResponse, ContainerSummary, ResponseError } from "../../clients/docker";
import { Logger } from "../../logging";
import * as dockerContainers from "../containers";
import * as dockerImages from "../images";
import { LocalResourceContainer, LocalResourceWorkflow } from "./base";

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
  let imageExistsStub: sinon.SinonStub;
  let pullImageStub: sinon.SinonStub;

  let workflow: TestWorkflow;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    showErrorMessageStub = sandbox.stub(window, "showErrorMessage").resolves();

    getContainerStub = sandbox.stub(dockerContainers, "getContainer");
    startContainerStub = sandbox.stub(dockerContainers, "startContainer");
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

  it("handleExistingContainers() should handle an existing container and show the user a 'Start' button", async () => {
    const workflowStartContainerStub = sandbox.stub(workflow, "startContainer");
    const fakeContainers: ContainerSummary[] = [
      { Id: "1", Names: ["/container1"], Image: "image1", State: "exited" },
    ];

    await workflow.handleExistingContainers(fakeContainers);

    assert.ok(
      showErrorMessageStub.calledOnceWith(
        "Existing test container found. Please start or remove it and try again.",
        "Start",
      ),
    );
    // if the user clicks 'Start', the workflow will call startContainer()
    assert.ok(workflowStartContainerStub.notCalled);
  });

  it("handleExistingContainers() should call .startContainer() if the user clicks the 'Start' button", async () => {
    const fakeContainers: ContainerSummary[] = [
      { Id: "1", Names: ["/container1"], Image: "image1", State: "exited" },
    ];
    // stub the user clicking the 'Start' button
    const button = "Start";
    showErrorMessageStub.resolves(button);

    await workflow.handleExistingContainers(fakeContainers);

    assert.ok(
      showErrorMessageStub.calledOnceWith(
        "Existing test container found. Please start or remove it and try again.",
        button,
      ),
    );
    // base method is called with the container ID+name, standalone function just uses ID
    assert.ok(startContainerStub.calledOnceWith(fakeContainers[0].Id!));
  });

  // FIXME(shoup): figure out why this is only saying it's called once
  it.skip("handleExistingContainers() should handle multiple existing containers and show the user a 'Start All' button", async () => {
    const workflowStartContainerStub = sandbox.stub(workflow, "startContainer");
    const fakeContainers: ContainerSummary[] = [
      { Id: "1", Names: ["/container1"], Image: "image1", State: "exited" },
      { Id: "2", Names: ["/container2"], Image: "image1", State: "exited" },
    ];
    // stub the user clicking the 'Start All' button
    const button = "Start All";
    showErrorMessageStub.resolves(button);

    await workflow.handleExistingContainers(fakeContainers);

    assert.ok(
      showErrorMessageStub.calledOnceWith(
        "Existing test containers found. Please start or remove them and try again.",
        button,
      ),
    );
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

  // TODO(shoup): update this in downstream branch
  // it("handleExistingContainers() should handle 'running' containers and prompt the user to restart them", async () => {
  //   const fakeContainers: ContainerSummary[] = [
  //     { Id: "1", Names: ["/container1"], Image: "image1", State: "running" },
  //   ];
  //   // stub the user clicking the 'Restart' button
  //   const button = "Restart";
  //   showErrorMessageStub.resolves(button);

  //   await workflow.handleExistingContainers(fakeContainers);

  //   assert.ok(
  //     showErrorMessageStub.calledOnceWith(
  //       "Existing test container found. Please restart or remove it and try again.",
  //       button,
  //     ),
  //   );
  //   assert.ok(startContainerStub.notCalled);
  // });

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
