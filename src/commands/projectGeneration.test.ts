import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import {
  ScaffoldV1TemplateListApiVersionEnum,
  ScaffoldV1TemplateListDataInner,
  ScaffoldV1TemplateListDataInnerApiVersionEnum,
  ScaffoldV1TemplateListDataInnerKindEnum,
  ScaffoldV1TemplateListKindEnum,
} from "../clients/scaffoldingService";
import * as projectGeneration from "./projectGeneration";
import { scaffoldProjectRequest } from "./projectGeneration";

describe.only("projectGeneration", () => {
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
          options: {
            api_key: "default-key",
            secret_key: "default-secret",
            bootstrap_server: "localhost:9092",
            topic_name: "test-topic",
          },
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
          options: {
            api_key: "default-key",
            secret_key: "default-secret",
            bootstrap_server: "localhost:9092",
            topic_name: "test-topic",
          },
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
          options: {
            api_key: "default-key",
            secret_key: "default-secret",
            bootstrap_server: "localhost:9092",
            topic_name: "test-topic",
          },
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

    getTemplatesStub = sandbox.stub(projectGeneration, "getTemplatesList").resolves(mockTemplates);
    quickPickStub = sandbox.stub(vscode.window, "showQuickPick").resolves(undefined);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("filters templates by kafka tags when templateType is kafka", async () => {
    await scaffoldProjectRequest({ templateType: "kafka" });
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
    await scaffoldProjectRequest({ templateType: "flink" });
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

    const result = await scaffoldProjectRequest({ templateType: "kafka" });
    assert.strictEqual(result, undefined);
  });

  it("finds specific template when templateName is provided", async () => {
    await scaffoldProjectRequest({
      templateName: "kafka-js",
      templateType: "kafka",
    });

    const quickPickItems = quickPickStub.firstCall?.args[0] as vscode.QuickPickItem[];
    assert.ok(!quickPickItems, "QuickPick should not be shown when template is specified");
  });

  it("preserves all options when sanitizeOptions is false", async () => {
    const result = await projectGeneration.getTemplatesList(undefined, false);
    const template = Array.from(result.data)[0] as ScaffoldV1TemplateListDataInner;

    sinon.assert.calledWith(getTemplatesStub, undefined, false);
    assert.deepStrictEqual((template.spec as { options: Record<string, string> }).options, {
      api_key: "default-key",
      secret_key: "default-secret",
      bootstrap_server: "localhost:9092",
      topic_name: "test-topic",
    });
  });

  it("filters sensitive options when sanitizeOptions is true", async () => {
    const result = await projectGeneration.getTemplatesList(undefined, true);
    const template = Array.from(result.data)[0] as ScaffoldV1TemplateListDataInner;

    sinon.assert.calledWith(getTemplatesStub, undefined, true);
    assert.deepStrictEqual((template.spec as { options: Record<string, string> }).options, {
      bootstrap_server: "localhost:9092",
      topic_name: "test-topic",
    });
  });
});
