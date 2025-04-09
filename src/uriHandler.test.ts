import * as vscode from "vscode";
import { UriEventHandler } from "../src/uriHandler";
import { ScaffoldV1Template } from "../src/clients/scaffoldingService";
import * as applyTemplateModule from "../src/scaffold";
import * as sinon from "sinon";
import assert from "assert";

describe.only("UriEventHandler - /projectScaffold", () => {
  let uriHandler: UriEventHandler;
  let applyTemplateStub: sinon.SinonStub;

  beforeEach(() => {
    uriHandler = UriEventHandler.getInstance();
    applyTemplateStub = sinon.stub(applyTemplateModule, "applyTemplate");
  });

  afterEach(() => {
    sinon.restore();
  });

  it("should call applyTemplate with correct parameters", async () => {
    // Arrange
    const uri = vscode.Uri.parse(
      "vscode://confluentinc.vscode-confluent/projectScaffold?collection=myCollection&template=myTemplate&cc_bootstrap_server=myBootstrapServer&cc_api_key=myApiKey&cc_api_secret=myApiSecret&cc_topic=myTopic",
    );

    applyTemplateStub.resolves({ success: true, message: "Project generated successfully." });

    // Act
    await uriHandler.handleUri(uri);

    // Assert
    assert.strictEqual(applyTemplateStub.calledOnce, true, "applyTemplate should be called once");
    const [template, options] = applyTemplateStub.firstCall.args;

    assert.deepStrictEqual(template, {
      spec: {
        name: "myTemplate",
        template_collection: { id: "myCollection" },
        display_name: "myTemplate",
      },
    } as ScaffoldV1Template);

    assert.deepStrictEqual(options, {
      cc_bootstrap_server: "myBootstrapServer",
      cc_api_key: "myApiKey",
      cc_api_secret: "myApiSecret",
      cc_topic: "myTopic",
    });
  });

  it("should show an error message if required parameters are missing", async () => {
    // Arrange
    const uri = vscode.Uri.parse(
      "vscode://confluentinc.vscode-confluent/projectScaffold?template=myTemplate",
    );

    const showErrorMessageStub = sinon.stub(vscode.window, "showErrorMessage");

    // Act
    await uriHandler.handleUri(uri);

    // Assert
    assert.strictEqual(applyTemplateStub.notCalled, true, "applyTemplate should not be called");
    assert.strictEqual(
      showErrorMessageStub.calledOnceWith(
        "Missing required parameters for project generation. Please check the URI.",
      ),
      true,
      "showErrorMessage should be called with the correct message",
    );
  });

  it("should show an error message if applyTemplate fails", async () => {
    // Arrange
    const uri = vscode.Uri.parse(
      "vscode://confluentinc.vscode-confluent/projectScaffold?collection=myCollection&template=myTemplate",
    );

    applyTemplateStub.rejects(new Error("Failed to apply template."));
    const showErrorMessageStub = sinon.stub(vscode.window, "showErrorMessage");

    // Act
    await uriHandler.handleUri(uri);

    // Assert
    assert.strictEqual(applyTemplateStub.calledOnce, true, "applyTemplate should be called once");
    assert.strictEqual(
      showErrorMessageStub.calledOnceWith("Error generating project: Failed to apply template."),
      true,
      "showErrorMessage should be called with the correct error message",
    );
  });
});
