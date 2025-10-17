import * as assert from "assert";
import * as sinon from "sinon";
import { window } from "vscode";
import { StubbedWorkspaceConfiguration } from "../../../tests/stubs/workspaceConfiguration";
import type { ContainerInspectResponse, ContainerSummary } from "../../clients/docker";
import { ResponseError } from "../../clients/docker";
import {
  LOCAL_KAFKA_IMAGE,
  LOCAL_MEDUSA_IMAGE,
  LOCAL_SCHEMA_REGISTRY_IMAGE,
} from "../../extensionSettings/constants";
import { Logger } from "../../logging";
import * as dockerContainers from "../containers";
import * as dockerImages from "../images";
import type { LocalResourceContainer } from "./base";
import { LocalResourceWorkflow } from "./base";
import { ConfluentLocalWorkflow } from "./confluent-local";
import { MedusaWorkflow } from "./medusa";
import { registerLocalResourceWorkflows } from "./workflowInitialization";

class TestWorkflow extends LocalResourceWorkflow {
  waitForReadiness(containerId: string): Promise<boolean> {
    throw new Error(containerId);
  }
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

    sinon.assert.calledOnceWithExactly(imageExistsStub, "repo", "tag");
    sinon.assert.calledOnceWithExactly(pullImageStub, "repo", "tag");
  });

  it("checkForImage() should not pull image if it already exists", async () => {
    imageExistsStub.resolves(true);

    await workflow["checkForImage"]("repo", "tag");

    sinon.assert.calledOnceWithExactly(imageExistsStub, "repo", "tag");
    sinon.assert.notCalled(pullImageStub);
  });

  it("handleExistingContainers() should handle an existing container and automatically start it if it isn't running", async () => {
    const workflowStartContainerStub = sandbox.stub(workflow, "startContainer");
    const fakeContainers: ContainerSummary[] = [
      { Id: "1", Names: ["/container1"], Image: "image1", State: "exited" },
    ];

    await workflow.handleExistingContainers(fakeContainers);

    sinon.assert.calledOnceWithExactly(workflowStartContainerStub, {
      id: fakeContainers[0].Id!,
      name: fakeContainers[0].Names![0],
    });
  });

  it("handleExistingContainers() should handle multiple existing containers and automatically start them all", async () => {
    const workflowStartContainerStub = sandbox.stub(workflow, "startContainer");
    const fakeContainers: ContainerSummary[] = [
      { Id: "1", Names: ["/container1"], Image: "image1", State: "exited" },
      { Id: "2", Names: ["/container2"], Image: "image1", State: "exited" },
    ];

    await workflow.handleExistingContainers(fakeContainers);

    sinon.assert.calledTwice(workflowStartContainerStub);
    sinon.assert.calledWith(workflowStartContainerStub, {
      id: fakeContainers[0].Id!,
      name: fakeContainers[0].Names![0],
    });
    sinon.assert.calledWith(workflowStartContainerStub, {
      id: fakeContainers[1].Id!,
      name: fakeContainers[1].Names![0],
    });
  });

  it("handleExistingContainers() should handle 'running' containers auto-restart them", async () => {
    const fakeContainers: ContainerSummary[] = [
      { Id: "1", Names: ["/container1"], Image: "image1", State: "running" },
    ];

    await workflow.handleExistingContainers(fakeContainers);

    sinon.assert.calledOnceWithExactly(restartContainerStub, fakeContainers[0].Id!);
  });

  it("startContainer() should start a container and return its inspect response", async () => {
    const fakeContainer: LocalResourceContainer = { id: "1", name: "test-container" };
    const fakeResponse: ContainerInspectResponse = { Id: "1" };
    startContainerStub.resolves();
    getContainerStub.resolves(fakeResponse);

    const result = await workflow.startContainer(fakeContainer);

    assert.strictEqual(result, fakeResponse);
    sinon.assert.calledOnceWithExactly(startContainerStub, fakeContainer.id);
    sinon.assert.calledOnceWithExactly(getContainerStub, fakeContainer.id);
    sinon.assert.notCalled(showErrorMessageStub);
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
    sinon.assert.calledOnceWithExactly(startContainerStub, fakeContainer.id);
    sinon.assert.notCalled(getContainerStub);
    sinon.assert.calledOnceWithExactly(
      showErrorMessageStub,
      'Failed to start test container "test-container": Port 8082 is already in use.',
      "Open Logs",
      "File Issue",
    );
  });

  it("startContainer() should return nothing and display non-ResponseError error messages in an error notification", async () => {
    const fakeContainer: LocalResourceContainer = { id: "1", name: "test-container" };
    const fakeError = new Error("uh oh");
    startContainerStub.rejects(fakeError);

    const result = await workflow.startContainer(fakeContainer);

    assert.strictEqual(result, undefined);
    sinon.assert.calledOnceWithExactly(startContainerStub, fakeContainer.id);
    sinon.assert.notCalled(getContainerStub);
    sinon.assert.calledOnceWithExactly(
      showErrorMessageStub,
      'Failed to start test container "test-container": uh oh',
      "Open Logs",
      "File Issue",
    );
  });
});

describe("docker/workflows/index.ts LocalResourceWorkflow registry", () => {
  let sandbox: sinon.SinonSandbox;

  // vscode stubs
  let showErrorMessageStub: sinon.SinonStub;
  let stubbedConfigs: StubbedWorkspaceConfiguration;

  before(() => {
    registerLocalResourceWorkflows();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    showErrorMessageStub = sandbox.stub(window, "showErrorMessage").resolves();
    stubbedConfigs = new StubbedWorkspaceConfiguration(sandbox);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it(`getKafkaWorkflow() should show an error notification and throw an error if no workflow matches the "${LOCAL_KAFKA_IMAGE.id}" setting`, async () => {
    const unsupportedImageRepo = "unsupported/image-name";
    stubbedConfigs.stubGet(LOCAL_KAFKA_IMAGE, unsupportedImageRepo);

    assert.throws(
      LocalResourceWorkflow.getKafkaWorkflow,
      new Error(`Unsupported Kafka image repo: ${unsupportedImageRepo}`),
    );
    sinon.assert.calledOnce(showErrorMessageStub);
  });

  it(`getKafkaWorkflow() should return a ConfluentLocalWorkflow instance for the correct "${LOCAL_KAFKA_IMAGE.id}" setting`, async () => {
    stubbedConfigs.stubGet(LOCAL_KAFKA_IMAGE, ConfluentLocalWorkflow.imageRepo);

    const workflow = LocalResourceWorkflow.getKafkaWorkflow();

    assert.ok(workflow instanceof ConfluentLocalWorkflow);
  });

  it(`getSchemaRegistryWorkflow() should show an error notification and throw an error if no workflow matches the "${LOCAL_SCHEMA_REGISTRY_IMAGE.id}" setting`, async () => {
    const unsupportedImageRepo = "unsupported/image-name";
    stubbedConfigs.stubGet(LOCAL_SCHEMA_REGISTRY_IMAGE, unsupportedImageRepo);

    assert.throws(
      LocalResourceWorkflow.getSchemaRegistryWorkflow,
      new Error(`Unsupported Schema Registry image repo: ${unsupportedImageRepo}`),
    );
    sinon.assert.calledOnce(showErrorMessageStub);
  });

  it(`getSchemaRegistryWorkflow() should return a ConfluentLocalWorkflow instance for the correct "${LOCAL_SCHEMA_REGISTRY_IMAGE.id}" setting`, async () => {
    stubbedConfigs.stubGet(LOCAL_SCHEMA_REGISTRY_IMAGE, ConfluentLocalWorkflow.imageRepo);

    const workflow = LocalResourceWorkflow.getSchemaRegistryWorkflow();

    assert.ok(workflow instanceof ConfluentLocalWorkflow);
  });

  it(`getMedusaWorkflow() should show an error notification and throw an error if no workflow matches the "${LOCAL_MEDUSA_IMAGE.id}" setting`, async () => {
    const unsupportedImageRepo = "unsupported/image-name";
    stubbedConfigs.stubGet(LOCAL_MEDUSA_IMAGE, unsupportedImageRepo);

    assert.throws(
      LocalResourceWorkflow.getMedusaWorkflow,
      new Error(`Unsupported Medusa image repo: ${unsupportedImageRepo}`),
    );
    assert.ok(showErrorMessageStub.calledOnce);
  });

  it(`getMedusaWorkflow() should return a MedusaWorkflow instance for the correct "${LOCAL_MEDUSA_IMAGE.id}" setting`, async () => {
    stubbedConfigs.stubGet(LOCAL_MEDUSA_IMAGE, MedusaWorkflow.imageRepo);

    const workflow = LocalResourceWorkflow.getMedusaWorkflow();

    assert.ok(workflow instanceof MedusaWorkflow);
  });
});
