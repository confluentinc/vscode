import { expect } from "@playwright/test";
import * as path from "path";
import { fileURLToPath } from "url";
import { test } from "../baseTest";
import { ConnectionType } from "../connectionTypes";
import {
  FlinkDatabaseView,
  FlinkViewMode,
  SelectFlinkDatabase,
} from "../objects/views/FlinkDatabaseView";
import { Tag } from "../tags";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe("Flink Artifacts", { tag: [Tag.CCloud, Tag.FlinkArtifacts] }, () => {
  test.use({ connectionType: ConnectionType.Ccloud });
  test.beforeEach(async ({ connectionItem }) => {
    await expect(connectionItem.locator).toHaveAttribute("aria-expanded", "true");
  });

  const artifactPath = path.join(
    __dirname,
    "..",
    "..",
    "fixtures/flink-artifacts",
    "udfs-simple.jar",
  );

  const entrypoints = [
    {
      entrypoint: SelectFlinkDatabase.FromArtifactsViewButton,
      testName: "should upload Flink Artifact when cluster selected from Artifacts view button",
    },
    {
      entrypoint: SelectFlinkDatabase.DatabaseFromResourcesView,
      testName: "should upload Flink Artifact when cluster selected from the Resources view",
    },
  ];

  for (const config of entrypoints) {
    test(config.testName, async ({ page, electronApp }) => {
      const artifactsView = new FlinkDatabaseView(page);
      await artifactsView.loadArtifacts(config.entrypoint);
      await artifactsView.clickSwitchToFlinkResource(FlinkViewMode.Artifacts);
      const uploadedArtifactName = await artifactsView.uploadFlinkArtifact(
        electronApp,
        artifactPath,
        false,
      );

      await expect(artifactsView.artifacts.filter({ hasText: uploadedArtifactName })).toHaveCount(
        1,
      );

      await artifactsView.deleteFlinkArtifact(uploadedArtifactName);
      await expect(artifactsView.artifacts.filter({ hasText: uploadedArtifactName })).toHaveCount(
        0,
      );
    });
  }

  test("should upload Flink Artifact when compute pool selected from the Resources view", async ({
    page,
    electronApp,
  }) => {
    const artifactsView = new FlinkDatabaseView(page);

    await artifactsView.ensureExpanded();
    await artifactsView.loadArtifacts(SelectFlinkDatabase.ComputePoolFromResourcesView);
    const uploadedArtifactName = await artifactsView.uploadFlinkArtifact(
      electronApp,
      artifactPath,
      true,
    );

    // Get the cluster label from the currently selected Flink database view
    const clusterLabel = await artifactsView.getCurrentKafkaClusterLabel();

    await artifactsView.clickSelectKafkaClusterAsFlinkDatabase();
    await page.keyboard.type(clusterLabel || "azure"); // fallback to "azure" if undefined
    await page.keyboard.press("Enter");
    await artifactsView.clickSwitchToFlinkResource(FlinkViewMode.Artifacts);

    await expect(artifactsView.artifacts.first()).toBeVisible();
    await expect(artifactsView.artifacts.filter({ hasText: uploadedArtifactName })).toHaveCount(1);

    await artifactsView.deleteFlinkArtifact(uploadedArtifactName);

    await expect(artifactsView.artifacts.filter({ hasText: uploadedArtifactName })).toHaveCount(0);
  });
});
