import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import type { ScaffoldV1Template } from "../clients/scaffoldingService";
import * as authnUtils from "../authn/utils";
import * as templates from "./templates";
import { filterSensitiveKeys, pickTemplate, sanitizeTemplateOptions } from "./templates";

describe("templates.ts", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("filterSensitiveKeys", () => {
    it("filters out keys containing 'key' or 'secret'", () => {
      const input = {
        api_key: "sensitive",
        secret_token: "sensitive",
        bootstrap_server: "localhost:9092",
        topic_name: "test-topic",
      };

      const result = filterSensitiveKeys(input);

      assert.deepStrictEqual(
        result,
        {
          bootstrap_server: "localhost:9092",
          topic_name: "test-topic",
        },
        "Should filter out sensitive keys while preserving others",
      );
    });
  });

  describe("sanitizeTemplateOptions", () => {
    it("should filter out sensitive keys from template options", () => {
      const template = {
        spec: {
          name: "test-template",
          options: {
            api_key: "secret-key",
            secret: "secret-value",
            normalOption: "normal-value",
            anotherOption: "another-value",
          },
        },
      } as unknown as ScaffoldV1Template;

      const result = sanitizeTemplateOptions(template);

      assert.strictEqual(result.spec?.name, "test-template");
      assert.strictEqual(result.spec?.options?.normalOption, "normal-value");
      assert.strictEqual(result.spec?.options?.anotherOption, "another-value");
      assert.strictEqual(result.spec?.options?.api_key, undefined);
      assert.strictEqual(result.spec?.options?.secret, undefined);
    });

    it("should handle template with no options", () => {
      const template = {
        spec: {
          name: "test-template",
        },
      } as ScaffoldV1Template;

      const result = sanitizeTemplateOptions(template);

      assert.strictEqual(result.spec?.name, "test-template");
      assert.deepStrictEqual(result.spec?.options, {});
    });

    it("should handle template with no spec", () => {
      const template = {} as ScaffoldV1Template;

      const result = sanitizeTemplateOptions(template);

      assert.deepStrictEqual(result.spec?.options, {});
    });
  });

  describe("createScaffoldingApi", () => {
    it("should create API client with correct configuration", () => {
      sandbox.stub(authnUtils, "getCCloudAuthSession").resolves({
        accessToken: "test-token",
        id: "test-session",
        account: { id: "test", label: "Test" },
        scopes: [],
      });

      const api = templates.createScaffoldingApi();

      assert.ok(api, "Should create API instance");
      assert.ok(api.listScaffoldV1Templates, "Should have listScaffoldV1Templates method");
      assert.ok(api.applyScaffoldV1Template, "Should have applyScaffoldV1Template method");
    });
  });

  describe("getTemplatesList", () => {
    it("should fetch templates and return them unsanitized by default", async () => {
      const fakeTemplates = [
        { spec: { name: "java-client" } },
        { spec: { name: "python-client" } },
      ] as ScaffoldV1Template[];

      const fakeResponse = {
        api_version: "scaffold/v1",
        kind: "TemplateList",
        metadata: {},
        data: new Set(fakeTemplates),
      };

      const listTemplatesStub = sandbox.stub().resolves(fakeResponse);
      const mockApiFactory = () =>
        ({
          listScaffoldV1Templates: listTemplatesStub,
        }) as any;

      const result = await templates.getTemplatesList(undefined, false, mockApiFactory);

      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].spec?.name, "java-client");
      assert.strictEqual(result[1].spec?.name, "python-client");
    });

    it("should sanitize templates when sanitizeOptions is true", async () => {
      const fakeTemplates = [
        {
          spec: {
            name: "java-client",
            options: {
              api_key: "secret",
              bootstrap_server: "localhost:9092",
            },
          },
        },
      ] as unknown as ScaffoldV1Template[];

      const fakeResponse = {
        api_version: "scaffold/v1",
        kind: "TemplateList",
        metadata: {},
        data: new Set(fakeTemplates),
      };

      const listTemplatesStub = sandbox.stub().resolves(fakeResponse);
      const mockApiFactory = () =>
        ({
          listScaffoldV1Templates: listTemplatesStub,
        }) as any;

      const result = await templates.getTemplatesList("vscode", true, mockApiFactory);

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].spec?.options?.api_key, undefined);
      assert.strictEqual(result[0].spec?.options?.bootstrap_server, "localhost:9092");
    });

    it("should use custom collection name when provided", async () => {
      const fakeResponse = {
        api_version: "scaffold/v1",
        kind: "TemplateList",
        metadata: {},
        data: new Set([]),
      };

      const listTemplatesStub = sandbox.stub().resolves(fakeResponse);
      const mockApiFactory = () =>
        ({
          listScaffoldV1Templates: listTemplatesStub,
        }) as any;

      await templates.getTemplatesList("custom-collection", false, mockApiFactory);

      sinon.assert.calledOnce(listTemplatesStub);
      sinon.assert.calledWithMatch(listTemplatesStub, {
        template_collection_name: "custom-collection",
      });
    });
  });

  describe("pickTemplate", () => {
    it("should return the selected template", async () => {
      const template = {
        spec: { name: "java-client", display_name: "java-client" },
      } as ScaffoldV1Template;
      const quickPickStub = sandbox.stub(vscode.window, "showQuickPick").resolves({
        label: "java-client",
        value: template,
      } as any);
      const result = await pickTemplate([template]);
      assert.strictEqual(result, template);
      sinon.assert.calledOnce(quickPickStub);
    });

    it("should return undefined if no template is selected", async () => {
      const template = {
        spec: { name: "java-client", display_name: "java-client" },
      } as ScaffoldV1Template;
      sandbox.stub(vscode.window, "showQuickPick").resolves(undefined);
      const result = await pickTemplate([template]);
      assert.strictEqual(result, undefined);
    });

    it("should present templates to the user sorted by display_name", async () => {
      const unsortedTemplates = [
        { spec: { display_name: "Flink Table API In Java For Confluent Cloud", name: "flink" } },
        { spec: { display_name: "AWS Lambda Consumer Application In Python", name: "python" } },
        { spec: { display_name: "AWS Lambda Consumer Application In JavaScript", name: "js" } },
      ];

      let quickPickLabels: string[] = [];
      sandbox
        .stub(vscode.window, "showQuickPick")
        .callsFake(
          (items: readonly vscode.QuickPickItem[] | Thenable<readonly vscode.QuickPickItem[]>) => {
            // Handle both direct array and promise
            if (Array.isArray(items)) {
              quickPickLabels = items.map((i) => i.label);
              return Promise.resolve(items[0]);
            }
            return Promise.resolve(undefined);
          },
        );

      await pickTemplate(unsortedTemplates as any);

      assert.deepStrictEqual(
        quickPickLabels,
        [
          "AWS Lambda Consumer Application In JavaScript",
          "AWS Lambda Consumer Application In Python",
          "Flink Table API In Java For Confluent Cloud",
        ],
        "Templates should be presented sorted by display_name",
      );
    });
  });
});
