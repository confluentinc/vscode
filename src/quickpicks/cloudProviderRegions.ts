import { QuickPickItemKind, ThemeIcon, window } from "vscode";
import { FcpmV2RegionListDataInner } from "../clients/flinkComputePool";
import { loadProviderRegions } from "../loaders/ccloudResourceLoader";
import { IProviderRegion } from "../models/resource";
import { QuickPickItemWithValue } from "./types";

export type regionFilter = (region: FcpmV2RegionListDataInner) => boolean;

export async function cloudProviderRegionQuickPick(
  filter?: regionFilter,
): Promise<IProviderRegion | undefined> {
  const regionData = await loadProviderRegions();

  const filteredRegions = filter ? regionData.filter(filter) : regionData;

  if (filteredRegions.length === 0) {
    return undefined;
  }
  let lastSeparator: string = "";

  const regionItems: QuickPickItemWithValue<IProviderRegion>[] = [];
  filteredRegions.forEach((region) => {
    if (region.cloud !== lastSeparator) {
      lastSeparator = region.cloud;
      regionItems.push({
        label: lastSeparator,
        description: "",
        kind: QuickPickItemKind.Separator,
      });
    }
    regionItems.push({
      label: region.display_name,
      description: region.http_endpoint,
      iconPath: new ThemeIcon("cloud"),
      value: {
        region: region.region_name,
        provider: region.cloud,
      },
    });
  });

  const chosenRegion: QuickPickItemWithValue<IProviderRegion> | undefined =
    await window.showQuickPick(regionItems, {
      placeHolder: "Select a region",
      ignoreFocusOut: true,
    });

  return chosenRegion?.value;
}
