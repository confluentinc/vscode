import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { ScaffoldV1Template } from "../clients/scaffoldingService";
import * as sidecarModule from "../sidecar";
import { getTemplatesList, pickTemplate } from "./templates";

describe("templates.ts", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
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
