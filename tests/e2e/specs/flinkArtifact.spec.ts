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
    const artifactsView = new ArtifactsView(page);
    await artifactsView.loadArtifacts(SelectFlinkDatabase.FromArtifactsViewButton);

    const uploadedArtifactName = await artifactsView.uploadFlinkArtifact(electronApp, artifactPath);

    await expect(artifactsView.artifacts.filter({ hasText: uploadedArtifactName })).toHaveCount(1);

    // Clean up: delete the uploaded artifact using the correct name
    await artifactsView.deleteFlinkArtifact(uploadedArtifactName);

    await expect(artifactsView.artifacts.filter({ hasText: uploadedArtifactName })).toHaveCount(0);
  });

  test("should upload Flink Artifact when cluster selected from the Resources view", async ({
    page,
    electronApp,
  }) => {
    const artifactsView = new ArtifactsView(page);
    await artifactsView.loadArtifacts(SelectFlinkDatabase.FromResourcesView);

    const uploadedArtifactName = await artifactsView.uploadFlinkArtifact(electronApp, artifactPath);

    await expect(artifactsView.artifacts.filter({ hasText: uploadedArtifactName })).toHaveCount(1);

    // Clean up: delete the uploaded artifact using the correct name
    await artifactsView.deleteFlinkArtifact(uploadedArtifactName);

    await expect(artifactsView.artifacts.filter({ hasText: uploadedArtifactName })).toHaveCount(0);
  });
});
