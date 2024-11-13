import * as assert from "assert";
import * as sinon from "sinon";
import * as dockerConfigs from "../docker/configs";
import { LocalResourceKind } from "../docker/constants";
import * as dockerWorkflows from "../docker/workflows";
import { ConfluentLocalWorkflow } from "../docker/workflows/confluent-local";
import { ConfluentPlatformSchemaRegistryWorkflow } from "../docker/workflows/cp-schema-registry";
import * as quickpicks from "../quickpicks/localResources";
import { runWorkflowWithProgress } from "./docker";

describe("commands/docker.ts runWorkflowWithProgress()", () => {
  let sandbox: sinon.SinonSandbox;

  // Docker+workflow stubs
  let isDockerAvailableStub: sinon.SinonStub;
  let localResourcesQuickPickStub: sinon.SinonStub;

  let getKafkaWorkflowStub: sinon.SinonStub;
  let getSchemaRegistryWorkflowStub: sinon.SinonStub;

  let stubKafkaWorkflow: sinon.SinonStubbedInstance<ConfluentLocalWorkflow>;
  let stubSchemaRegistryWorkflow: sinon.SinonStubbedInstance<ConfluentPlatformSchemaRegistryWorkflow>;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // default to Docker being available for majority of tests
    isDockerAvailableStub = sandbox.stub(dockerConfigs, "isDockerAvailable").resolves(true);

    // set default quickpick selection as just the Kafka resource for majority of tests
    localResourcesQuickPickStub = sandbox
      .stub(quickpicks, "localResourcesQuickPick")
      .resolves([LocalResourceKind.Kafka]);

    stubKafkaWorkflow = sandbox.createStubInstance(ConfluentLocalWorkflow);
    getKafkaWorkflowStub = sandbox
      .stub(dockerWorkflows, "getKafkaWorkflow")
      .returns(stubKafkaWorkflow);

    stubSchemaRegistryWorkflow = sandbox.createStubInstance(
      ConfluentPlatformSchemaRegistryWorkflow,
    );
    getSchemaRegistryWorkflowStub = sandbox
      .stub(dockerWorkflows, "getSchemaRegistryWorkflow")
      .returns(stubSchemaRegistryWorkflow);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should exit early if Docker is not available", async () => {
    isDockerAvailableStub.resolves(false);

    await runWorkflowWithProgress();

    assert.ok(localResourcesQuickPickStub.notCalled);
    assert.ok(getKafkaWorkflowStub.notCalled);
    assert.ok(getSchemaRegistryWorkflowStub.notCalled);
  });

  it("should skip running a workflow for unsupported Kafka images", async () => {
    getKafkaWorkflowStub.throws(new Error("Unsupported image blah blah"));

    await runWorkflowWithProgress();

    // `docker/workflows/index.test.ts` tests the error notification for this case
    assert.ok(stubKafkaWorkflow.start.notCalled);
    assert.ok(stubKafkaWorkflow.stop.notCalled);
  });

  it("should skip running a workflow for unsupported Schema Registry images", async () => {
    getSchemaRegistryWorkflowStub.throws(new Error("Unsupported image blah blah"));

    await runWorkflowWithProgress();

    // `docker/workflows/index.test.ts` tests the error notification for this case
    assert.ok(stubSchemaRegistryWorkflow.start.notCalled);
    assert.ok(stubSchemaRegistryWorkflow.stop.notCalled);
  });

  it("should show an workflow's error notification for uncaught errors in the workflow .start()", async () => {
    stubKafkaWorkflow.start.rejects(new Error("uh oh"));

    await runWorkflowWithProgress();

    assert.ok(stubKafkaWorkflow.start.calledOnce);
    assert.ok(stubKafkaWorkflow.stop.notCalled);
    assert.ok(stubKafkaWorkflow.showErrorNotification.calledOnce);
  });

  it("should show an workflow's error notification for uncaught errors in the workflow .stop()", async () => {
    stubKafkaWorkflow.stop.rejects(new Error("uh oh"));

    await runWorkflowWithProgress(false);

    assert.ok(stubKafkaWorkflow.start.notCalled);
    assert.ok(stubKafkaWorkflow.stop.calledOnce);
    assert.ok(stubKafkaWorkflow.showErrorNotification.calledOnce);
  });

  // TODO(shoup): update these in follow-on branch once multi-select quickpick is added
  it("should call the Kafka workflow's .start() method when start=true", async () => {
    await runWorkflowWithProgress();

    assert.ok(stubKafkaWorkflow.start.calledOnce);
    assert.ok(stubKafkaWorkflow.stop.notCalled);
  });

  it("should call the Kafka workflow's .stop() method when start=false", async () => {
    await runWorkflowWithProgress(false);

    assert.ok(stubKafkaWorkflow.start.notCalled);
    assert.ok(stubKafkaWorkflow.stop.calledOnce);
  });

  it("should call multiple workflows' .start() methods when multiple resources are selected", async () => {
    localResourcesQuickPickStub.resolves([
      LocalResourceKind.Kafka,
      LocalResourceKind.SchemaRegistry,
    ]);

    await runWorkflowWithProgress();

    assert.ok(stubKafkaWorkflow.start.calledOnce);
    assert.ok(stubSchemaRegistryWorkflow.start.calledOnce);
  });

  it("should call multiple workflows' .stop() methods when multiple resources are selected and start=false", async () => {
    localResourcesQuickPickStub.resolves([
      LocalResourceKind.Kafka,
      LocalResourceKind.SchemaRegistry,
    ]);

    await runWorkflowWithProgress(false);

    assert.ok(stubKafkaWorkflow.stop.calledOnce);
    assert.ok(stubSchemaRegistryWorkflow.stop.calledOnce);
  });
});
