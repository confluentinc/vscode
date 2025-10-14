import { expect } from "@playwright/test";
import { test } from "../baseTest";
import { ConnectionType } from "../connectionTypes";
import { ArtifactsView } from "../objects/views/ArtifactsView";
import { Tag } from "../tags";

import { SelectFlinkDatabase } from "../objects/views/ArtifactsView";

test.describe("Flink Artifacts", { tag: [Tag.CCloud, Tag.FlinkArtifacts] }, () => {
  test.use({ connectionType: ConnectionType.Ccloud });

  test.beforeEach(async ({ connectionItem }) => {
    // ensure connection tree item has resources available to work with
    await expect(connectionItem.locator).toHaveAttribute("aria-expanded", "true");
  });

  test("should show artifacts view", async ({ page }) => {
    // Use existing page object models for common interactions
    const artifactsView = new ArtifactsView(page);
    // NOTE: might have to be done differently, but right here all I want is to confirm the tab exists
    await artifactsView.loadArtifacts(ConnectionType.Ccloud, SelectFlinkDatabase.FromResourcesView);
    await expect(artifactsView.header).toHaveAttribute("aria-expanded", "true");
    await expect(artifactsView.body).toBeVisible();
  });
});
