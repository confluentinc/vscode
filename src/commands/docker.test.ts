import * as assert from "assert";
import * as sinon from "sinon";
import { window } from "vscode";
import * as dockerConfigs from "../docker/configs";
import * as dockerWorkflows from "../docker/workflows";
import { ConfluentLocalWorkflow } from "../docker/workflows/confluent-local";
import { runWorkflowWithProgress } from "./docker";

describe("commands/docker.ts runWorkflowWithProgress()", () => {
  let sandbox: sinon.SinonSandbox;

  // vscode stubs
  let showErrorMessageStub: sinon.SinonStub;

  // Docker+workflow stubs
  let getKafkaWorkflowStub: sinon.SinonStub;
  let isDockerAvailableStub: sinon.SinonStub;
  let stubbedKafkaWorkflow: sinon.SinonStubbedInstance<ConfluentLocalWorkflow>;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    showErrorMessageStub = sandbox.stub(window, "showErrorMessage").resolves();

    // default to Docker being available for majority of tests
    isDockerAvailableStub = sandbox.stub(dockerConfigs, "isDockerAvailable").resolves(true);
    stubbedKafkaWorkflow = sandbox.createStubInstance(ConfluentLocalWorkflow);
    getKafkaWorkflowStub = sandbox
      .stub(dockerWorkflows, "getKafkaWorkflow")
      .returns(stubbedKafkaWorkflow);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should show a basic error notification if Docker is not available", async () => {
    isDockerAvailableStub.resolves(false);

    await runWorkflowWithProgress();

    assert.ok(showErrorMessageStub.calledOnce);
    assert.ok(stubbedKafkaWorkflow.start.notCalled);
    assert.ok(stubbedKafkaWorkflow.stop.notCalled);
  });

  it("should skip running a workflow for unsupported images", async () => {
    getKafkaWorkflowStub.throws(new Error("Unsupported image blah blah"));

    await runWorkflowWithProgress();

    // `docker/workflows/index.test.ts` tests the error notification for this case
    assert.ok(stubbedKafkaWorkflow.start.notCalled);
    assert.ok(stubbedKafkaWorkflow.stop.notCalled);
  });

  it("should show an workflow's error notification for uncaught errors in the workflow .start()", async () => {
    stubbedKafkaWorkflow.start.rejects(new Error("uh oh"));

    await runWorkflowWithProgress();

    assert.ok(stubbedKafkaWorkflow.start.calledOnce);
    assert.ok(stubbedKafkaWorkflow.stop.notCalled);
    assert.ok(stubbedKafkaWorkflow.showErrorNotification.calledOnce);
  });

  it("should show an workflow's error notification for uncaught errors in the workflow .stop()", async () => {
    stubbedKafkaWorkflow.stop.rejects(new Error("uh oh"));

    await runWorkflowWithProgress(false);

    assert.ok(stubbedKafkaWorkflow.start.notCalled);
    assert.ok(stubbedKafkaWorkflow.stop.calledOnce);
    assert.ok(stubbedKafkaWorkflow.showErrorNotification.calledOnce);
  });

  // TODO(shoup): update these in follow-on branch once multi-select quickpick is added
  it("should call the Kafka workflow's .start() method when start=true", async () => {
    await runWorkflowWithProgress();

    assert.ok(stubbedKafkaWorkflow.start.calledOnce);
    assert.ok(stubbedKafkaWorkflow.stop.notCalled);
  });

  it("should call the Kafka workflow's .stop() method when start=false", async () => {
    await runWorkflowWithProgress(false);

    assert.ok(stubbedKafkaWorkflow.start.notCalled);
    assert.ok(stubbedKafkaWorkflow.stop.calledOnce);
  });
});
