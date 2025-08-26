import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { ConnectionType } from "../clients/sidecar";
import { FlinkArtifact } from "../models/flinkArtifact";
import { ConnectionId, EnvironmentId } from "../models/resource";
import { queryArtifactWithFlink } from "./flinkArtifacts";

describe("flinkArtifacts", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should open a new Flink SQL document with placeholder query for valid artifact", async () => {
    const artifact = new FlinkArtifact({
      id: "artifact-id",
      name: "test-artifact",
      description: "description",
      connectionId: "conn-id" as ConnectionId,
      connectionType: "ccloud" as ConnectionType,
      environmentId: "env-id" as EnvironmentId,
      provider: "aws",
      region: "us-west-2",
    });
    const openTextDocStub = sandbox
      .stub(vscode.workspace, "openTextDocument")
      .resolves({} as vscode.TextDocument);
    const showTextDocStub = sandbox.stub(vscode.window, "showTextDocument").resolves();

    await queryArtifactWithFlink(artifact);

    sinon.assert.calledOnce(openTextDocStub);
    const callArgs = openTextDocStub.getCall(0).args[0];
    assert.ok(callArgs, "openTextDocStub was not called with any arguments");
    assert.strictEqual(callArgs.language, "flinksql");
    assert.ok(
      typeof callArgs.content === "string" &&
        callArgs.content.includes('CREATE FUNCTION "test-artifact"'),
      "callArgs.content should include the CREATE FUNCTION statement",
    );
    sinon.assert.calledOnce(showTextDocStub);
  });
});
