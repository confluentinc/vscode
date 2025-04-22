import assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { projectScaffoldUri } from "../src/emitters";
import { UriEventHandler } from "../src/uriHandler";

describe("UriEventHandler - /projectScaffold", () => {
  let uriHandler: UriEventHandler;
  let projectScaffoldUriStub: sinon.SinonStub;
  let sandbox = sinon.createSandbox();

  beforeEach(() => {
    uriHandler = UriEventHandler.getInstance();
    projectScaffoldUriStub = sandbox.stub(projectScaffoldUri, "fire");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should emit projectScaffoldUri event with correct URI", async () => {
    const uri = vscode.Uri.parse(
      "vscode://confluentinc.vscode-confluent/projectScaffold?collection=myCollection&template=myTemplate&cc_bootstrap_server=myBootstrapServer&cc_api_key=myApiKey&cc_api_secret=myApiSecret&cc_topic=myTopic",
    );

    await uriHandler.handleUri(uri);

    assert.strictEqual(
      projectScaffoldUriStub.calledOnce,
      true,
      "projectScaffoldUri should be fired once",
    );
    assert.strictEqual(projectScaffoldUriStub.firstCall.args[0].toString(), uri.toString());
  });
});
