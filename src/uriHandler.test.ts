import assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { flinkWorkspaceUri, projectScaffoldUri } from "../src/emitters";
import { UriEventHandler } from "../src/uriHandler";

describe("UriEventHandler", () => {
  let uriHandler: UriEventHandler;
  let projectScaffoldUriStub: sinon.SinonStub;
  let flinkWorkspaceUriStub: sinon.SinonStub;
  let sandbox = sinon.createSandbox();

  beforeEach(() => {
    uriHandler = UriEventHandler.getInstance();
    projectScaffoldUriStub = sandbox.stub(projectScaffoldUri, "fire");
    flinkWorkspaceUriStub = sandbox.stub(flinkWorkspaceUri, "fire");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should emit projectScaffoldUri event with correct URI", async () => {
    const scaffoldUri = vscode.Uri.parse(
      "vscode://confluentinc.vscode-confluent/projectScaffold?collection=myCollection&template=myTemplate&cc_bootstrap_server=myBootstrapServer&cc_api_key=myApiKey&cc_api_secret=myApiSecret&cc_topic=myTopic",
    );

    await uriHandler.handleUri(scaffoldUri);

    assert.strictEqual(
      projectScaffoldUriStub.calledOnce,
      true,
      "projectScaffoldUri should be fired once",
    );
    assert.strictEqual(projectScaffoldUriStub.firstCall.args[0].toString(), scaffoldUri.toString());
  });

  it("should emit flinkWorkspaceUri event with correct URI", async () => {
    const flinkWorkspaceUri = vscode.Uri.parse(
      "vscode://confluentinc.vscode-confluent/flinkWorkspace?environmentId=my-env&provider=aws&region=us-east-2&organizationId=my-orgworkspaceName=my-workspace",
    );
    await uriHandler.handleUri(flinkWorkspaceUri);

    assert.strictEqual(
      flinkWorkspaceUriStub.calledOnce,
      true,
      "flinkWorkspaceUri should be fired once",
    );
    assert.strictEqual(
      flinkWorkspaceUriStub.firstCall.args[0].toString(),
      flinkWorkspaceUri.toString(),
    );
  });
});
