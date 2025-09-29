import { QuickPickItemKind, window } from "vscode";
import { FcpmV2RegionListDataInner } from "../clients/flinkComputePool";
import { FLINK_CONFIG_COMPUTE_POOL } from "../extensionSettings/constants";
import { CCloudResourceLoader, loadProviderRegions } from "../loaders/ccloudResourceLoader";
import { CCloudFlinkDbKafkaCluster } from "../models/kafkaCluster";
import { IProviderRegion } from "../models/resource";
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

  const getDetail = (region: FcpmV2RegionListDataInner): string | undefined => {
    if (matchesSelectedFlinkDatabase(region)) {
      return "currently selected database";
    } else if (matchesDefaultComputePool(region)) {
      return "default compute pool";
    }
    return undefined;
  };

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
      detail: getDetail(region),
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

/**
 * Quickpick that shows only the cloud provider + region combinations that the user can access
 * through existing Flink databases (Flinkable Kafka clusters).
 * Includes a trailing "View All" item which, if selected, opens the full list of region/providers
 * {@link cloudProviderRegionQuickPick} (with optional filter parameter forwarded) so the user can
 * choose among all available regions.
 * @returns {Promise<IProviderRegion | undefined>} region selected or undefined if cancelled.
 */
export async function flinkDatabaseRegionsQuickPick(
  filter?: regionFilter,
): Promise<IProviderRegion | undefined> {
  const loader = CCloudResourceLoader.getInstance();
  const flinkDbClusters: CCloudFlinkDbKafkaCluster[] = await loader.getFlinkDatabases();

  // Apply filter to remove databases in GCP (not supported)
  const filteredDbs = flinkDbClusters.filter((c) => {
    return c.provider !== "GCP";
  });

  // Group by provider then region, collecting the database (cluster) names.
  const clusterRegions = new Map<string, IProviderRegion & { names: string[] }>();
  for (const c of filteredDbs) {
    const key = `${c.provider}|${c.region}`;
    let agg = clusterRegions.get(key);
    if (!agg) {
      agg = { provider: c.provider, region: c.region, names: [] };
      clusterRegions.set(key, agg);
    }
    agg.names.push(c.name);
  }

  // Convert to array and sort by provider then region then first database name.
  const regionsList = Array.from(clusterRegions.values()).sort((a, b) => {
    if (a.provider !== b.provider) {
      return a.provider.localeCompare(b.provider);
    }
    if (a.region !== b.region) {
      return a.region.localeCompare(b.region);
    }
    return a.names[0].localeCompare(b.names[0]);
  });

  const quickPickItems: QuickPickItemWithValue<IProviderRegion | "VIEW_ALL">[] = [];
  let lastProvider = "";
  for (const entry of regionsList) {
    if (entry.provider !== lastProvider) {
      lastProvider = entry.provider;
      quickPickItems.push({
        label: entry.provider,
        description: "",
        kind: QuickPickItemKind.Separator,
      });
    }
    quickPickItems.push({
      label: `${entry.provider} | ${entry.region}`,
      description: Array.from(entry.names)
        .sort((a, b) => a.localeCompare(b))
        .join(", "),
      value: { provider: entry.provider, region: entry.region },
    });
  }

  quickPickItems.push({
    label: "View All Available Regions",
    description: "Show the complete list of regions",
    value: "VIEW_ALL",
  });

  const choice = await window.showQuickPick(quickPickItems, {
    placeHolder: "Select a region containing a Flink database",
    ignoreFocusOut: true,
  });

  if (!choice) {
    return undefined; // user cancelled
  }
  if (choice.value === "VIEW_ALL") {
    return await cloudProviderRegionQuickPick(filter);
  }

  return choice.value as IProviderRegion;
}
