import { expect } from "@playwright/test";
import { test } from "../baseTest";
import { NotificationArea } from "../objects/notifications/NotificationArea";
import { FlinkDatabaseView } from "../objects/views/FlinkDatabaseView";
import { Tag } from "../tags";
import { ConnectionType } from "../types/connection";
import { randomHexString } from "../utils/strings";

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
        const functionName = `test_udf_${randomHexString(6)}`;

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

        const editorContent = page.locator(".monaco-editor .view-lines");
        await expect(editorContent).toBeVisible();

        const editorText = await editorContent.textContent();
        expect(editorText).toMatch(/CREATE\s+FUNCTION/);
        expect(editorText).toMatch(/USING\s+JAR/);
        expect(editorText).toContain("confluent-artifact://");
        // not testing the statement submission behavior here since those are covered by the
        // @flink-statements tests, and the document is just a template with snippet placeholders
      });

      test("should delete a UDF", async ({ page, artifact }) => {
        const flinkDatabaseView = new FlinkDatabaseView(page);
        const functionName = `test_udf_delete_${randomHexString(6)}`;

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
