import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import {
  ScaffoldV1TemplateListApiVersionEnum,
  ScaffoldV1TemplateListDataInner,
  ScaffoldV1TemplateListDataInnerApiVersionEnum,
  ScaffoldV1TemplateListDataInnerKindEnum,
  ScaffoldV1TemplateListKindEnum,
} from "./clients/scaffoldingService";
import * as scaffold from "./scaffold";

describe("scaffoldProjectRequest", () => {
  let sandbox: sinon.SinonSandbox;
  let getTemplatesStub: sinon.SinonStub;
  let quickPickStub: sinon.SinonStub;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    const templateData: ScaffoldV1TemplateListDataInner[] = [
      {
        api_version: ScaffoldV1TemplateListDataInnerApiVersionEnum.ScaffoldV1,
        kind: ScaffoldV1TemplateListDataInnerKindEnum.Template,
        metadata: { self: undefined },
        spec: {
          name: "kafka-js",
          display_name: "Kafka Client In JavaScript",
          description: "A simple JavaScript project",
          tags: ["producer", "consumer", "javascript"],
        },
      },
      {
        api_version: ScaffoldV1TemplateListDataInnerApiVersionEnum.ScaffoldV1,
        kind: ScaffoldV1TemplateListDataInnerKindEnum.Template,
        metadata: { self: undefined },
        spec: {
          name: "flink-sql",
          display_name: "Flink SQL Application",
          description: "A Flink SQL application",
          tags: ["apache flink", "table api"],
        },
      },
      {
        api_version: ScaffoldV1TemplateListDataInnerApiVersionEnum.ScaffoldV1,
        kind: ScaffoldV1TemplateListDataInnerKindEnum.Template,
        metadata: { self: undefined },
        spec: {
          name: "other-template",
          display_name: "Other Template",
          description: "Another template",
          tags: ["other"],
        },
      },
    ];

    const mockTemplates = {
      api_version: ScaffoldV1TemplateListApiVersionEnum.ScaffoldV1,
      kind: ScaffoldV1TemplateListKindEnum.TemplateList,
      metadata: {
        first: true,
        last: true,
        total_size: 3,
      },
      data: new Set(templateData),
    };

    getTemplatesStub = sandbox.stub(scaffold, "getTemplatesList").resolves(mockTemplates);
    quickPickStub = sandbox.stub(vscode.window, "showQuickPick").resolves(undefined);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("filters templates by kafka tags when templateType is kafka", async () => {
    await scaffold.scaffoldProjectRequest({ templateType: "kafka" });
    const quickPickItems = quickPickStub.firstCall.args[0] as vscode.QuickPickItem[];
    assert.ok(quickPickItems.length > 0, "Should have at least one Kafka template");
    assert.ok(
      quickPickItems.every(
        (item) => item.description?.includes("producer") || item.description?.includes("consumer"),
      ),
      "All items should be Kafka related",
    );
  });

  it("filters templates by flink tags when templateType is flink", async () => {
    await scaffold.scaffoldProjectRequest({ templateType: "flink" });
    const quickPickItems = quickPickStub.firstCall.args[0] as vscode.QuickPickItem[];
    assert.ok(quickPickItems.length > 0, "Should have at least one Flink template");
    assert.ok(
      quickPickItems.every(
        (item) =>
          item.description?.includes("apache flink") || item.description?.includes("table api"),
      ),
      "All items should be Flink related",
    );
  });

  it("returns undefined when no templates are available", async () => {
    getTemplatesStub.resolves({
      api_version: ScaffoldV1TemplateListApiVersionEnum.ScaffoldV1,
      kind: ScaffoldV1TemplateListKindEnum.TemplateList,
      metadata: { first: true, last: true, total_size: 0 },
      data: new Set([]),
    });

    const result = await scaffold.scaffoldProjectRequest({ templateType: "kafka" });
    assert.strictEqual(result, undefined);
  });

  it("finds specific template when templateName is provided", async () => {
    await scaffold.scaffoldProjectRequest({
      templateName: "kafka-js",
      templateType: "kafka",
    });

    const quickPickItems = quickPickStub.firstCall?.args[0] as vscode.QuickPickItem[];
    assert.ok(!quickPickItems, "QuickPick should not be shown when template is specified");
  });

  it("filters out sensitive options containing 'key' or 'secret'", () => {
    const template: ScaffoldV1TemplateListDataInner = {
      api_version: ScaffoldV1TemplateListDataInnerApiVersionEnum.ScaffoldV1,
      kind: ScaffoldV1TemplateListDataInnerKindEnum.Template,
      metadata: { self: undefined },
      spec: {
        name: "test-template",
        options: {
          api_key: { description: "API Key" },
          secret_key: { description: "Secret Key" },
          bootstrap_server: { description: "Bootstrap Server" },
          topic_name: { description: "Topic Name" },
        },
      },
    };

    const result: ScaffoldV1TemplateListDataInner = scaffold.sanitizeTemplateOptions(template);

    // Check that non-sensitive fields are preserved
    assert.strictEqual(result.api_version, template.api_version);
    assert.strictEqual(result.kind, template.kind);
    assert.deepStrictEqual(result.metadata, template.metadata);

    // Check that sensitive options are filtered out
    const options = (result.spec as { options?: Record<string, unknown> })?.options || {}; // Ensure result is typed correctly
    assert.ok(!("api_key" in options), "api_key should be filtered out");
    assert.ok(!("secret_key" in options), "secret_key should be filtered out");

    // Check that non-sensitive options are preserved
    assert.ok("bootstrap_server" in options, "bootstrap_server should be preserved");
    assert.ok("topic_name" in options, "topic_name should be preserved");

    // Check that option objects are properly copied
    assert.deepStrictEqual(
      options.bootstrap_server,
      (template.spec as { options?: Record<string, unknown> })?.options?.bootstrap_server,
      "Option object should be preserved",
    );
  });
});
