import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { ScaffoldV1Template } from "../clients/scaffoldingService";
import * as sidecarModule from "../sidecar";
import { getTemplatesList, pickTemplate, sanitizeTemplateOptions } from "./templates";

describe("templates.ts", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
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

  describe("getTemplatesList", () => {
    it("should fetch templates and return them unsanitized by default", async () => {
      const fakeTemplates = [
        { spec: { name: "java-client" } },
        { spec: { name: "python-client" } },
      ] as ScaffoldV1Template[];
      const fakeApi = {
        listScaffoldV1Templates: sandbox.stub().resolves({ data: fakeTemplates }),
      };

      const fakeSidecarHandle = { getTemplatesApi: () => fakeApi };
      sandbox.stub(sidecarModule, "getSidecar").resolves(fakeSidecarHandle as any);

      const result = await getTemplatesList("my-collection");
      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].spec?.name, "java-client");
      assert.strictEqual(result[1].spec?.name, "python-client");
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
  });
});
