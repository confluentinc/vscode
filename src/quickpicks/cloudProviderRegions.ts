import { QuickPickItemKind, ThemeIcon, window } from "vscode";
import { FcpmV2RegionListDataInner } from "../clients/flinkComputePool";
import { FLINK_CONFIG_COMPUTE_POOL } from "../extensionSettings/constants";
import { CCloudResourceLoader, loadProviderRegions } from "../loaders/ccloudResourceLoader";
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
  // Sorts regions so that:
  //  (0) the default compute pool's provider+region appears first (if configured),
  //  (1) regions that match existing compute pools come next,
  //  (2) all others follow.
  const loader = CCloudResourceLoader.getInstance();
  const computePoolRegions = await loader.getComputePoolProviderRegions();
  const defaultComputePoolId = FLINK_CONFIG_COMPUTE_POOL.value;
  const defaultPool = defaultComputePoolId
    ? await loader.getFlinkComputePool(defaultComputePoolId)
    : undefined;

  const hasComputePool = (region: FcpmV2RegionListDataInner) =>
    computePoolRegions.some(
      (pr) => pr.provider === region.cloud && pr.region === region.region_name,
    );

  const rankFor = (region: FcpmV2RegionListDataInner) => {
    if (hasComputePool(region)) {
      return 0;
    }
    return 1;
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

  if (defaultPool) {
    // Move the default compute pool's region to the top.
    const defaultIndex = filteredRegions.findIndex(
      (r) => r.cloud === defaultPool.provider && r.region_name === defaultPool.region,
    );
    if (defaultIndex > 0) {
      const [defaultRegion] = filteredRegions.splice(defaultIndex, 1);
      filteredRegions.unshift(defaultRegion);
    }
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
