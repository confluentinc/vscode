import { expect } from "@playwright/test";
import { test } from "../baseTest";
import { TextDocument } from "../objects/editor/TextDocument";
import { NotificationArea } from "../objects/notifications/NotificationArea";
import { FlinkDatabaseView } from "../objects/views/FlinkDatabaseView";
import { Tag } from "../tags";
import { ConnectionType } from "../types/connection";
import { e2eResourceName } from "../utils/uniqueName";

test.describe("Flink UDFs", { tag: [Tag.CCloud, Tag.FlinkUDFs] }, () => {
  test.use({ connectionType: ConnectionType.Ccloud });

  // TODO: add GCP, see https://github.com/confluentinc/vscode/issues/2817
  const providers = [
    { provider: "AWS", region: "us-east-2" },
    { provider: "AZURE", region: "eastus" },
  ];

  for (const { provider, region } of providers) {
    test.describe(provider, () => {
      test.use({ artifactConfig: { provider, region } });

      test("should create a UDF via the guided flow", async ({ page, artifact }) => {
        const flinkDatabaseView = new FlinkDatabaseView(page);
        const functionName = e2eResourceName("udf");

        await flinkDatabaseView.startGuidedUdfCreation(
          artifact,
          "io.confluent.udf.examples.scalar.SumScalarFunction",
          functionName,
        );

        const notificationArea = new NotificationArea(page);
        const successNotifications = notificationArea.infoNotifications.filter({
          hasText: "function created successfully",
        });
        await expect(successNotifications.first()).toBeVisible({ timeout: 60_000 });

        // search auto-expands the matching container, so we don't need to expand UDFs manually
        const udfItem = await flinkDatabaseView.getItemByLabel(functionName);
        await expect(udfItem).toBeVisible();
      });

      test("should open a Flink SQL document with the appropriate content", async ({
        page,
        artifact,
      }) => {
        const flinkDatabaseView = new FlinkDatabaseView(page);

        await flinkDatabaseView.openUdfRegistrationDocument(artifact);

        // the registration command opens a fresh untitled doc with snippets
        const registrationDoc = new TextDocument(page, "Untitled-1");
        await expect(registrationDoc.locator).toBeVisible();
        await expect(registrationDoc.editorContent).toContainText(/CREATE\s+FUNCTION/);
        await expect(registrationDoc.editorContent).toContainText(/USING\s+JAR/);
        await expect(registrationDoc.editorContent).toContainText("confluent-artifact://");
        // not testing the statement submission behavior here since those are covered by the
        // @flink-statements tests, and the document is just a template with snippet placeholders
      });

      test("should delete a UDF", async ({ page, artifact }) => {
        const flinkDatabaseView = new FlinkDatabaseView(page);
        const functionName = e2eResourceName("udf-delete");

        await flinkDatabaseView.startGuidedUdfCreation(
          artifact,
          "io.confluent.udf.examples.scalar.ConcatScalarFunction",
          functionName,
        );

        const notificationArea = new NotificationArea(page);
        const createNotifications = notificationArea.infoNotifications.filter({
          hasText: "function created successfully",
        });
        await expect(createNotifications.first()).toBeVisible({ timeout: 60_000 });

        const udfItemBefore = await flinkDatabaseView.getItemByLabel(functionName);
        await expect(udfItemBefore).toBeVisible();

        await flinkDatabaseView.deleteFlinkUdf(functionName);
        // search filter from deleteFlinkUdf is still applied, so the deleted UDF drops out
        const udfItemAfter = flinkDatabaseView.udfs.filter({ hasText: functionName });
        await expect(udfItemAfter).toHaveCount(0);
      });
    });
  }
});
