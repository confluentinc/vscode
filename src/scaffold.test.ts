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
});
