import sinon from "sinon";
import * as vscode from "vscode";
import { FlinkArtifactsArtifactV1Api } from "../../clients/flinkArtifacts";
import { ConnectionType } from "../../clients/sidecar";
import { IconNames } from "../../constants";
import { FlinkArtifact } from "../../models/flinkArtifact";
import { ConnectionId, EnvironmentId } from "../../models/resource";
import * as sidecar from "../../sidecar";
import { deleteArtifactCommand } from "./deleteArtifact";
describe("deleteArtifactCommand", () => {
  let sandbox: sinon.SinonSandbox;
  beforeEach(() => {
    sandbox = sinon.createSandbox();
    const mockSidecarHandle: sinon.SinonStubbedInstance<sidecar.SidecarHandle> =
      sandbox.createStubInstance(sidecar.SidecarHandle);
    let flinkArtifactsApiStub = sandbox.createStubInstance(FlinkArtifactsArtifactV1Api);
    mockSidecarHandle.getFlinkArtifactsApi.returns(flinkArtifactsApiStub);
    sandbox.stub(sidecar, "getSidecar").resolves(mockSidecarHandle);
  });
  afterEach(() => {
    sandbox.restore();
  });

  const mockArtifact: FlinkArtifact = {
    id: "artifact-id",
    name: "Test Artifact",
    provider: "aws",
    region: "us-west-2",
    environmentId: "env-id" as EnvironmentId,
    connectionId: "conn-id" as ConnectionId,
    iconName: IconNames.FLINK_ARTIFACT,
    description: "",
    searchableText: () => "",
    connectionType: ConnectionType.Local,
  };

  describe("deleteArtifactCommand", () => {
    it("should exit silently if user does not confirm that they want to delete the artifact", async () => {
      sandbox.stub(vscode.window, "showWarningMessage").resolves(undefined);
      const showInformationMessageStub = sandbox.stub(vscode.window, "showInformationMessage");
      const deleteArtifactV1FlinkArtifactStub = sandbox.stub().resolves();

      await deleteArtifactCommand(mockArtifact);

      sinon.assert.notCalled(deleteArtifactV1FlinkArtifactStub);
      sinon.assert.notCalled(showInformationMessageStub);
    });
    it("should call the sidecar to delete the artifact and show a success message", async () => {
      sandbox.stub(vscode.window, "showWarningMessage").resolves({ title: "Yes, delete" });
      const showInformationMessageStub = sandbox.stub(vscode.window, "showInformationMessage");

      await deleteArtifactCommand(mockArtifact);
      sinon.assert.calledOnce(showInformationMessageStub);
    });
  });
});
