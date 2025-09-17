import { QuickPickItemKind, window } from "vscode";
import { FcpmV2RegionListDataInner } from "../clients/flinkComputePool";
import { FLINK_CONFIG_COMPUTE_POOL } from "../extensionSettings/constants";
import { CCloudResourceLoader, loadProviderRegions } from "../loaders/ccloudResourceLoader";
import { IProviderRegion } from "../models/resource";
import { hasCCloudAuthSession } from "../sidecar/connections/ccloud";
import { FlinkDatabaseViewProvider } from "../viewProviders/flinkDatabase";
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
  if (hasCCloudAuthSession()) {
    // Sorts regions so that:
    //  (0) the selected database's provider+region appears first (if set),
    //  (1) the default compute pool's provider+region appears first (if configured),
    //  (2) regions that match existing compute pools come next,
    //  (3) all others follow.
    const loader = CCloudResourceLoader.getInstance();
    const computePoolRegions = await loader.getComputePoolProviderRegions();

    const flinkDatabaseViewProvider = FlinkDatabaseViewProvider.getInstance();
    const selectedFlinkDatabase = flinkDatabaseViewProvider.database;
    const matchesSelectedFlinkDatabase = (region: FcpmV2RegionListDataInner) =>
      selectedFlinkDatabase?.provider === region.cloud &&
      selectedFlinkDatabase?.region === region.region_name;

    const defaultComputePoolId = FLINK_CONFIG_COMPUTE_POOL.value;
    const defaultPool = defaultComputePoolId
      ? await loader.getFlinkComputePool(defaultComputePoolId)
      : undefined;
    const matchesDefaultComputePool = (region: FcpmV2RegionListDataInner) =>
      defaultPool?.provider === region.cloud && defaultPool?.region === region.region_name;

    const hasComputePool = (region: FcpmV2RegionListDataInner) =>
      computePoolRegions.some(
        (pr) => pr.provider === region.cloud && pr.region === region.region_name,
      );

    const rankFor = (region: FcpmV2RegionListDataInner) => {
      if (selectedFlinkDatabase != null && matchesSelectedFlinkDatabase(region)) {
        return 0;
      } else if (defaultPool != null && matchesDefaultComputePool(region)) {
        return 1;
      } else if (computePoolRegions.length > 0 && hasComputePool(region)) {
        return 2;
      }
      return 3;
    };

    filteredRegions.sort((a, b) => {
      const ra = rankFor(a);
      const rb = rankFor(b);
      if (ra !== rb) {
        return ra - rb;
      }
      // Tie-breaker to keep grouping by cloud provider for separators.
      if (a.cloud !== b.cloud) {
        return a.cloud.localeCompare(b.cloud);
      }
      return a.region_name.localeCompare(b.region_name);
    });
  }

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
