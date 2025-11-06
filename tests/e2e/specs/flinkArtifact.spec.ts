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

  test("should upload Flink Artifact", async ({ page }) => {
    const artifactsView = new ArtifactsView(page);
    await artifactsView.loadArtifacts(SelectFlinkDatabase.FromArtifactsViewButton);
    const artifactName = "udfs-simple.jar";
    const artifactPath = path.join(__dirname, "..", "..", "fixtures/flink-artifacts", artifactName);

    await artifactsView.uploadFlinkArtifact(artifactPath);
    const artifactCountBeforeUpload = await artifactsView.artifacts.count();

    const uploadedArtifact = artifactsView.artifacts.filter({
      hasText: artifactName,
    });

    expect(await uploadedArtifact.count()).toBe(artifactCountBeforeUpload + 1);

    // Clean up: delete the uploaded artifact
    await artifactsView.deleteFlinkArtifact(artifactName);
    const artifactCountAfterDeletion = await artifactsView.artifacts.count();
    expect(artifactCountAfterDeletion).toBe(artifactCountBeforeUpload);
  });
});
