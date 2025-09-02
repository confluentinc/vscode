import sinon from "sinon";
import * as vscode from "vscode";
import { ConnectionType } from "../../clients/sidecar";
import { IconNames } from "../../constants";
import { FlinkArtifact } from "../../models/flinkArtifact";
import { ConnectionId, EnvironmentId } from "../../models/resource";
import * as sidecarModule from "../../sidecar";
import { deleteArtifactCommand } from "./deleteArtifact";

describe("deleteArtifactCommand", () => {
  let sandbox: sinon.SinonSandbox;
  beforeEach(() => {
    sandbox = sinon.createSandbox();
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

      const getSidecarStub = sandbox.stub().resolves({
        getFlinkArtifactsApi: () => ({
          deleteArtifactV1FlinkArtifact: deleteArtifactV1FlinkArtifactStub,
        }),
      });

      sandbox.replace(sidecarModule, "getSidecar", getSidecarStub);

      await deleteArtifactCommand(mockArtifact);

      sinon.assert.notCalled(deleteArtifactV1FlinkArtifactStub);
      sinon.assert.notCalled(showInformationMessageStub);
    });
    it("should call the sidecar to delete the artifact and show a success message", async () => {
      // Return a MessageItem object to match the implementation's check
      sandbox.stub(vscode.window, "showWarningMessage").resolves({ title: "Yes, delete" });
      const showInformationMessageStub = sandbox.stub(vscode.window, "showInformationMessage");

      const getSidecarStub = sandbox.stub().resolves({
        getFlinkArtifactsApi: () => ({
          deleteArtifactV1FlinkArtifact: sandbox.stub().resolves(),
        }),
      });

      sandbox.replace(sidecarModule, "getSidecar", getSidecarStub);

      await deleteArtifactCommand(mockArtifact);
      sinon.assert.calledOnce(showInformationMessageStub);
    });
  });
});
