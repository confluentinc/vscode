import { QuickPickItemKind, window } from "vscode";
import { FcpmV2RegionListDataInner } from "../clients/flinkComputePool";
import { FLINK_CONFIG_COMPUTE_POOL } from "../extensionSettings/constants";
import { CCloudResourceLoader, loadProviderRegions } from "../loaders/ccloudResourceLoader";
import { CCloudFlinkDbKafkaCluster } from "../models/kafkaCluster";
import { IProviderRegion } from "../models/resource";
import { ObjectSet } from "../utils/objectset";
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

  const awsSet = new ObjectSet<IProviderRegion>((pr) => `${pr.provider}-${pr.region}`);
  const azureSet = new ObjectSet<IProviderRegion>((pr) => `${pr.provider}-${pr.region}`);
  // GCP not supported for Flink artifacts yet
  for (const db of flinkDbClusters) {
    const pr = {
      provider: db.provider,
      region: db.region,
      name: db.name,
    };
    if (db.provider === "AWS") {
      awsSet.add(pr);
    } else if (db.provider === "AZURE") {
      azureSet.add(pr);
    }
  }
  const awsProviderRegions: IProviderRegion[] = awsSet
    .items()
    .sort((a, b) => a.region.localeCompare(b.region));
  const azureProviderRegions: IProviderRegion[] = azureSet
    .items()
    .sort((a, b) => a.region.localeCompare(b.region));

  const quickPickItems: QuickPickItemWithValue<IProviderRegion | "VIEW_ALL">[] = [];
  let lastProvider = "";
  for (const entry of [...awsProviderRegions, ...azureProviderRegions]) {
    if (entry.provider !== lastProvider) {
      lastProvider = entry.provider;
      quickPickItems.push({
        label: entry.provider,
        description: "",
        kind: QuickPickItemKind.Separator,
      });
    }
    // make the description out of the names of the databases in this provider+region
    const matchingDatabases = flinkDbClusters.filter(
      (db) => db.provider === entry.provider && db.region === entry.region,
    );
    quickPickItems.push({
      label: `${entry.provider} | ${entry.region}`,
      description: matchingDatabases.map((db) => db.name).join(", "),
      value: { provider: entry.provider, region: entry.region },
    });
  }

  quickPickItems.push(
    {
      label: "",
      description: "",
      kind: QuickPickItemKind.Separator,
    },
    {
      label: "View All Available Regions",
      description: "Show the complete list of regions",
      value: "VIEW_ALL",
      alwaysShow: true,
    },
  );

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
