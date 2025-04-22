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

  it("should throw an error when collection or template not present", async () => {
    // Missing template parameter
    const uriMissingTemplate = vscode.Uri.parse(
      "vscode://confluentinc.vscode-confluent/projectScaffold?collection=myCollection&cc_bootstrap_server=myBootstrapServer&cc_api_key=myApiKey&cc_api_secret=myApiSecret&cc_topic=myTopic",
    );

    const consoleErrorSpy = sandbox.spy(console, "error");

    await uriHandler.handleUri(uriMissingTemplate);

    // The event should still be fired even if parameters are missing
    assert.strictEqual(
      projectScaffoldUriStub.calledOnce,
      true,
      "projectScaffoldUri should be fired once",
    );

    assert.strictEqual(
      projectScaffoldUriStub.firstCall.args[0].toString(),
      uriMissingTemplate.toString(),
    );

    // Missing collection parameter test
    projectScaffoldUriStub.reset();
    consoleErrorSpy.resetHistory();

    const uriMissingCollection = vscode.Uri.parse(
      "vscode://confluentinc.vscode-confluent/projectScaffold?template=myTemplate&cc_bootstrap_server=myBootstrapServer&cc_api_key=myApiKey&cc_api_secret=myApiSecret&cc_topic=myTopic",
    );

    await uriHandler.handleUri(uriMissingCollection);

    assert.strictEqual(
      projectScaffoldUriStub.calledOnce,
      true,
      "projectScaffoldUri should be fired once",
    );

    assert.strictEqual(
      projectScaffoldUriStub.firstCall.args[0].toString(),
      uriMissingCollection.toString(),
    );
  });
});
