import { expect } from "@playwright/test";
import * as path from "path";
import { fileURLToPath } from "url";
import { test } from "../baseTest";
import { ConnectionType } from "../connectionTypes";
import { ArtifactsView, SelectFlinkDatabase } from "../objects/views/ArtifactsView";
import { Tag } from "../tags";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe("Flink Artifacts", { tag: [Tag.CCloud, Tag.FlinkArtifacts] }, () => {
  test.use({ connectionType: ConnectionType.Ccloud });
  test.beforeEach(async ({ connectionItem }) => {
    await expect(connectionItem.locator).toHaveAttribute("aria-expanded", "true");
  });

  test("should show Artifacts view when cluster selected from Resources view", async ({ page }) => {
    const artifactsView = new ArtifactsView(page);
    await artifactsView.loadArtifacts(SelectFlinkDatabase.FromResourcesView);
    expect(artifactsView.ensureExpanded).toBeTruthy();
  });

  test("should show Artifacts view when cluster selected from Artifacts view button", async ({
    page,
  }) => {
    const artifactsView = new ArtifactsView(page);
    await artifactsView.loadArtifacts(SelectFlinkDatabase.FromArtifactsViewButton);
    expect(artifactsView.ensureExpanded).toBeTruthy();
  });

  test("should upload Flink Artifact", async ({ page, electronApp }) => {
    const artifactsView = new ArtifactsView(page);
    await artifactsView.loadArtifacts(SelectFlinkDatabase.FromArtifactsViewButton);
    const artifactPath = path.join(
      __dirname,
      "..",
      "..",
      "fixtures/flink-artifacts",
      "udfs-simple.jar",
    );

    // Upload the artifact and get the generated name with random suffix
    const uploadedArtifactName = await artifactsView.uploadFlinkArtifact(electronApp, artifactPath);

    // Verify the specific artifact appears in the tree view
    await expect(artifactsView.artifacts.filter({ hasText: uploadedArtifactName })).toHaveCount(1);

    // Clean up: delete the uploaded artifact using the correct name
    await artifactsView.deleteFlinkArtifact(uploadedArtifactName);

    // Verify the artifact is removed from the tree view
    await expect(artifactsView.artifacts.filter({ hasText: uploadedArtifactName })).toHaveCount(0);
  });
});
