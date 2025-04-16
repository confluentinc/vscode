import { QuickPickItemKind, window } from "vscode";
import { CCloudResourceLoader } from "../loaders";
import { CCloudEnvironment } from "../models/environment";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { CCloudKafkaCluster } from "../models/kafkaCluster";
import { EnvironmentId } from "../models/resource";
import { CCloudSchemaRegistry } from "../models/schemaRegistry";
import { hasCCloudAuthSession } from "../sidecar/connections/ccloud";
import { ProviderRegion } from "../types";
import { QuickPickItemWithValue } from "./types";

export async function providerRegionQuickPick(
  filterPredicate?: (env: CCloudEnvironment) => boolean,
): Promise<ProviderRegion | undefined> {
  if (!hasCCloudAuthSession()) {
    window.showInformationMessage("No Confluent Cloud connection found.");
    return;
  }

  const envs: CCloudEnvironment[] = await CCloudResourceLoader.getInstance().getEnvironments();
  if (!envs.length) {
    window.showInformationMessage("No Confluent Cloud environments found.");
    return;
  }

  let providerRegionItems: QuickPickItemWithValue<ProviderRegion>[] = [];
  let lastEnvId: EnvironmentId | undefined;
  for (const env of envs) {
    if (filterPredicate && !filterPredicate(env)) {
      continue;
    }
    if (env.id !== lastEnvId) {
      // add separator
      providerRegionItems.push({
        label: env.name,
        value: { provider: "", region: "" },
        kind: QuickPickItemKind.Separator,
      });
      lastEnvId = env.id;
    }
    const providerRegions: ProviderRegion[] = [];
    for (const child of env.children) {
      const envResource = child as
        | CCloudKafkaCluster
        | CCloudSchemaRegistry
        | CCloudFlinkComputePool;
      const providerRegion: ProviderRegion = {
        provider: envResource.provider,
        region: envResource.region,
      };
      if (
        providerRegions.some(
          (pr) => pr.provider === providerRegion.provider && pr.region === providerRegion.region,
        )
      ) {
        continue;
      }
      providerRegions.push(providerRegion);
    }

    providerRegionItems.push(
      ...providerRegions
        .sort((pr1: ProviderRegion, pr2: ProviderRegion) => {
          if (pr1.provider === pr2.provider) {
            return pr1.region.localeCompare(pr2.region);
          }
          return pr1.provider.localeCompare(pr2.provider);
        })
        .map((providerRegion: ProviderRegion) => ({
          label: `${providerRegion.provider}:${providerRegion.region}`,
          value: providerRegion,
        })),
    );
  }

  // prompt the user to select an environment and return the corresponding CloudEnvironment
  const chosenProviderRegion: QuickPickItemWithValue<ProviderRegion> | undefined =
    await window.showQuickPick(providerRegionItems, {
      placeHolder: "Select a provider and region",
    });
  return chosenProviderRegion?.value;
}
