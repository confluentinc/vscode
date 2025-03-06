import * as assert from "assert";
import * as sinon from "sinon";
import { Uri, window, workspace } from "vscode";
import * as dockerConfigs from "../docker/configs";
import { LocalResourceKind } from "../docker/constants";
import { LocalResourceWorkflow } from "../docker/workflows/base";
import { ConfluentLocalWorkflow } from "../docker/workflows/confluent-local";
import { ConfluentPlatformSchemaRegistryWorkflow } from "../docker/workflows/cp-schema-registry";
import * as errors from "../errors";
import { LOCAL_DOCKER_SOCKET_PATH } from "../preferences/constants";
import * as quickpicks from "../quickpicks/localResources";
import { addDockerPath, orderWorkflows, runWorkflowWithProgress } from "./docker";

describe("commands/docker.ts runWorkflowWithProgress()", () => {
  let sandbox: sinon.SinonSandbox;

  let showErrorNotificationStub: sinon.SinonStub;

  // Docker+workflow stubs
  let isDockerAvailableStub: sinon.SinonStub;
  let localResourcesQuickPickStub: sinon.SinonStub;

  let getKafkaWorkflowStub: sinon.SinonStub;
  let getSchemaRegistryWorkflowStub: sinon.SinonStub;

  let stubKafkaWorkflow: sinon.SinonStubbedInstance<ConfluentLocalWorkflow>;
  let stubSchemaRegistryWorkflow: sinon.SinonStubbedInstance<ConfluentPlatformSchemaRegistryWorkflow>;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    showErrorNotificationStub = sandbox.stub(errors, "showErrorNotificationWithButtons").resolves();

    // default to Docker being available for majority of tests
    isDockerAvailableStub = sandbox.stub(dockerConfigs, "isDockerAvailable").resolves(true);

    // set default quickpick selection as just the Kafka resource for majority of tests
    localResourcesQuickPickStub = sandbox
      .stub(quickpicks, "localResourcesQuickPick")
      .resolves([LocalResourceKind.Kafka]);

    stubKafkaWorkflow = sandbox.createStubInstance(ConfluentLocalWorkflow);
    getKafkaWorkflowStub = sandbox
      .stub(LocalResourceWorkflow, "getKafkaWorkflow")
      .returns(stubKafkaWorkflow);

    stubSchemaRegistryWorkflow = sandbox.createStubInstance(
      ConfluentPlatformSchemaRegistryWorkflow,
    );
    getSchemaRegistryWorkflowStub = sandbox
      .stub(LocalResourceWorkflow, "getSchemaRegistryWorkflow")
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
    assert.ok(showErrorNotificationStub.calledOnce);
  });

  it("should show an workflow's error notification for uncaught errors in the workflow .stop()", async () => {
    stubKafkaWorkflow.stop.rejects(new Error("uh oh"));

    await runWorkflowWithProgress(false);

    assert.ok(stubKafkaWorkflow.start.notCalled);
    assert.ok(stubKafkaWorkflow.stop.calledOnce);
    assert.ok(showErrorNotificationStub.calledOnce);
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

describe("commands/docker.ts orderWorkflows()", () => {
  let sandbox: sinon.SinonSandbox;

  let stubKafkaWorkflow: sinon.SinonStubbedInstance<ConfluentLocalWorkflow>;
  let stubSchemaRegistryWorkflow: sinon.SinonStubbedInstance<ConfluentPlatformSchemaRegistryWorkflow>;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    // we could just call the singletons since we aren't dealing with any methods, but better to
    // be on the safe side and let sinon handle the cleanup/restoration
    stubKafkaWorkflow = sandbox.createStubInstance(ConfluentLocalWorkflow);
    stubSchemaRegistryWorkflow = sandbox.createStubInstance(
      ConfluentPlatformSchemaRegistryWorkflow,
    );
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should return the workflows with Kafka first when start=true and Kafka is included", () => {
    const workflows = [stubSchemaRegistryWorkflow, stubKafkaWorkflow];
    const orderedWorkflows = orderWorkflows(workflows, true);

    assert.strictEqual(orderedWorkflows[0].resourceKind, stubKafkaWorkflow.resourceKind);
    assert.strictEqual(orderedWorkflows[1].resourceKind, stubSchemaRegistryWorkflow.resourceKind);
  });

  it("should return the workflows with Kafka last when start=false and Kafka is included", () => {
    const workflows = [stubKafkaWorkflow, stubSchemaRegistryWorkflow];
    const orderedWorkflows = orderWorkflows(workflows, false);

    assert.strictEqual(orderedWorkflows[0].resourceKind, stubSchemaRegistryWorkflow.resourceKind);
    assert.strictEqual(orderedWorkflows[1].resourceKind, stubKafkaWorkflow.resourceKind);
  });

  it("should not sort workflows if there is only one workflow provided", () => {
    const workflows = [stubKafkaWorkflow];
    const orderedWorkflows = orderWorkflows(workflows, true);

    assert.equal(orderedWorkflows.length, 1);
    assert.strictEqual(orderedWorkflows[0].resourceKind, stubKafkaWorkflow.resourceKind);
  });

  // TODO(shoup): maybe update this once we include Flink and other resources
  it("should not sort workflows if Kafka is not included", () => {
    const workflows = [stubSchemaRegistryWorkflow];
    const orderedWorkflows = orderWorkflows(workflows, true);

    assert.equal(orderedWorkflows.length, 1);
    assert.strictEqual(orderedWorkflows[0].resourceKind, stubSchemaRegistryWorkflow.resourceKind);
  });
});

describe("commands/docker.ts addDockerPath()", () => {
  let sandbox: sinon.SinonSandbox;
  let showOpenDialogStub: sinon.SinonStub;
  let getConfigurationStub: sinon.SinonStub;
  let updateConfigStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    showOpenDialogStub = sandbox.stub(window, "showOpenDialog");
    getConfigurationStub = sandbox.stub(workspace, "getConfiguration");
    updateConfigStub = sandbox.stub();
  });

  afterEach(() => {
    sandbox.restore();
  });

  for (const filename of ["docker.sock", "docker_engine"]) {
    it(`should show open dialog and update config if file with a proper extension (${filename}) is selected`, async () => {
      const URI = { fsPath: `path/to/${filename}` } as Uri;
      showOpenDialogStub.resolves([URI]);
      getConfigurationStub.returns({
        get: sandbox.stub().returns([]),
        update: updateConfigStub,
      });
      await addDockerPath();

      assert.ok(showOpenDialogStub.calledOnce);
      assert.ok(updateConfigStub.calledOnce);
      assert.ok(updateConfigStub.calledOnceWith(LOCAL_DOCKER_SOCKET_PATH, URI.fsPath, true));
    });
  }

  it("should not update config if no file is selected", async () => {
    showOpenDialogStub.resolves(undefined);

    await addDockerPath();

    assert.ok(showOpenDialogStub.calledOnce);
    assert.ok(updateConfigStub.notCalled);
  });

  it("should not update config if invalid file is selected", async () => {
    const uri = { fsPath: "path/to/file.txt" } as Uri;
    showOpenDialogStub.resolves([uri]);

    getConfigurationStub.returns({
      get: sandbox.stub().returns([]),
      update: updateConfigStub,
    });

    await addDockerPath();

    assert.ok(showOpenDialogStub.calledOnce);
    assert.ok(updateConfigStub.notCalled);
  });
});
