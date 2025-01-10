import * as assert from "assert";
import * as sinon from "sinon";
import { window, workspace } from "vscode";
import { getKafkaWorkflow } from ".";
import { LOCAL_KAFKA_IMAGE } from "../../preferences/constants";
import { ConfluentLocalWorkflow } from "./confluent-local";

describe("docker/workflows/index.ts", () => {
  let sandbox: sinon.SinonSandbox;

  // vscode stubs
  let showErrorMessageStub: sinon.SinonStub;
  let getConfigurationStub: sinon.SinonStub;

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
      getKafkaWorkflow,
      new Error(`Unsupported Kafka image repo: ${unsupportedImageRepo}`),
    );
    assert.ok(showErrorMessageStub.calledOnce);
  });

  it(`getKafkaWorkflow() should return a ConfluentLocalWorkflow instance for the correct "${LOCAL_KAFKA_IMAGE}" config`, async () => {
    getConfigurationStub.returns({
      get: sandbox.stub().withArgs(LOCAL_KAFKA_IMAGE).returns(ConfluentLocalWorkflow.imageRepo),
    });

    const workflow = getKafkaWorkflow();

    assert.ok(workflow instanceof ConfluentLocalWorkflow);
  });
});
