import * as assert from "assert";
import sinon from "sinon";
import * as vscode from "vscode";
import { pickTemplate } from "./projectGeneration/templates";

describe("template sorting", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
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
