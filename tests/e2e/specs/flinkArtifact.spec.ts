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

  test("should upload Flink Artifact when cluster selected from Artifacts view button", async ({
    page,
    electronApp,
  }) => {
    const artifactsView = new FlinkDatabaseView(page);
    await artifactsView.loadArtifacts(SelectFlinkDatabase.FromArtifactsViewButton);
    await artifactsView.clickSwitchToFlinkResource(FlinkViewMode.Artifacts);
    const uploadedArtifactName = await artifactsView.uploadFlinkArtifact(
      electronApp,
      artifactPath,
      false,
    );

    await expect(artifactsView.artifacts.filter({ hasText: uploadedArtifactName })).toHaveCount(1);

    // Clean up: delete the uploaded artifact using the correct name
    await artifactsView.deleteFlinkArtifact(uploadedArtifactName);

    await expect(artifactsView.artifacts.filter({ hasText: uploadedArtifactName })).toHaveCount(0);
  });

  test("should upload Flink Artifact when cluster selected from the Resources view", async ({
    page,
    electronApp,
  }) => {
    const artifactsView = new FlinkDatabaseView(page);
    await artifactsView.loadArtifacts(SelectFlinkDatabase.DatabaseFromResourcesView);
    await artifactsView.clickSwitchToFlinkResource(FlinkViewMode.Artifacts);
    const uploadedArtifactName = await artifactsView.uploadFlinkArtifact(
      electronApp,
      artifactPath,
      false,
    );

    await expect(artifactsView.artifacts.filter({ hasText: uploadedArtifactName })).toHaveCount(1);

    // Clean up: delete the uploaded artifact using the correct name
    await artifactsView.deleteFlinkArtifact(uploadedArtifactName);

    await expect(artifactsView.artifacts.filter({ hasText: uploadedArtifactName })).toHaveCount(0);
  });
  test("should upload Flink Artifact when compute pool selected from the Resources view", async ({
    page,
    electronApp,
  }) => {
    const artifactsView = new FlinkDatabaseView(page);
    await artifactsView.ensureExpanded(); // Ensure the view is expanded

    await artifactsView.loadArtifacts(SelectFlinkDatabase.ComputePoolFromResourcesView);
    const uploadedArtifactName = await artifactsView.uploadFlinkArtifact(
      electronApp,
      artifactPath,
      true,
    );
    await artifactsView.clickSelectKafkaClusterAsFlinkDatabase();
    // progress--- we need to actually hit enter here
    await artifactsView.clickSwitchToFlinkResource(FlinkViewMode.Artifacts);
    // Wait for at least one artifact to be visible before checking for the specific one
    await expect(artifactsView.artifacts.first()).toBeVisible();

    await expect(artifactsView.artifacts.filter({ hasText: uploadedArtifactName })).toHaveCount(1);

    // Clean up: delete the uploaded artifact using the correct name
    await artifactsView.deleteFlinkArtifact(uploadedArtifactName);

    await expect(artifactsView.artifacts.filter({ hasText: uploadedArtifactName })).toHaveCount(0);
  });
});
