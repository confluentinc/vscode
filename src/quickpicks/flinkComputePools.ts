import { commands, QuickPickItemKind, ThemeIcon, window } from "vscode";
import { CCLOUD_SIGN_IN_BUTTON_LABEL } from "../authn/constants";
import { IconNames } from "../constants";
import { ContextValues, getContextValue } from "../context/values";
import { FLINK_CONFIG_COMPUTE_POOL } from "../extensionSettings/constants";
import { CCloudResourceLoader } from "../loaders";
import { Logger } from "../logging";
import { Environment } from "../models/environment";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { getConnectionLabel, isCCloud } from "../models/resource";
import { showInfoNotificationWithButtons } from "../notifications";
import { QuickPickItemWithValue } from "./types";

const logger = new Logger("quickpicks.flinkComputePools");

/** Wrapper for the Flink Compute Pool quickpick to accomodate data-fetching time and display a
 * progress indicator on the Resources or Flink Statements/Artifacts view(s). */
export async function flinkComputePoolQuickPickWithViewProgress(
  viewId: "confluent-resources" | "confluent-flink-statements" | "confluent-flink-database",
  initiallySelectedPool: CCloudFlinkComputePool | null = null,
): Promise<CCloudFlinkComputePool | undefined> {
  return await window.withProgress(
    {
      location: { viewId },
      title: "Loading Flink compute pools...",
    },
    async () => {
      return await flinkComputePoolQuickPick(initiallySelectedPool);
    },
  );
}

/**
 * Create and await a quickpick to let the user choose a {@link FlinkComputePool}, separated by
 * environment.
 *
 * Example:
 * ---------------------------------- Confluent Cloud: env1
 * ccloud-pool1 (lfcp-id1)
 * ccloud-pool2 (lfcp-id2)
 * ---------------------------------- Confluent Cloud: env2
 * ccloud-pool3 (lfcp-id3)
 *
 * If a currentlySelectedPool is provided, it will be pre-selected in the quickpick and
 * indicated with a 'selected' icon. Additionally, if the user has set a default compute
 * pool in the settings, it will be presented either at the top of the list (if no
 * currentlySelectedPool is provided) or second in the list (if a currentlySelectedPool
 * is provided and is different from the default).
 */
export async function flinkComputePoolQuickPick(
  initiallySelectedPool: CCloudFlinkComputePool | null = null,
  filterPredicate?: (pool: CCloudFlinkComputePool) => boolean,
): Promise<CCloudFlinkComputePool | undefined> {
  const loader = CCloudResourceLoader.getInstance();
  const environments: Environment[] = await loader.getEnvironments();
  const computePools: CCloudFlinkComputePool[] = [];
  for (const env of environments) {
    if (env.flinkComputePools) {
      const pools = env.flinkComputePools as CCloudFlinkComputePool[];
      // convert the pools data to CCloudFlinkComputePool instances
      computePools.push(...pools.map((pool) => new CCloudFlinkComputePool(pool)));
    }
  }

  if (computePools.length === 0) {
    let login: string = "";
    if (!getContextValue(ContextValues.ccloudConnectionAvailable)) {
      login = CCLOUD_SIGN_IN_BUTTON_LABEL;
    }
    showInfoNotificationWithButtons("No Flink compute pools available.", {
      [login]: () => commands.executeCommand("confluent.connections.ccloud.signIn"),
    });
    return;
  }

  logger.debug("generating Flink compute pool quickpick", {
    ccloud: computePools.filter((pool) => isCCloud(pool)).length,
  });

  // convert all available Flink comptue pools to quick pick items and keep track of the last env
  // name used for the separators
  const items: QuickPickItemWithValue<CCloudFlinkComputePool>[] = [];

  const focusedPools: CCloudFlinkComputePool[] = [];

  // Caller wanted us to pre-select a pool.
  if (initiallySelectedPool) {
    focusedPools.push(initiallySelectedPool);
  }

  // Add user preference default compute pool to focused pools (if set and if it exists and if it isn't currentlySelectedPool already
  // added to focusedPools). If exists and found, it will either be the only pool in focusedPools or the second (after currentlySelectedPool).
  const defaultComputePoolId = FLINK_CONFIG_COMPUTE_POOL.value;
  if (defaultComputePoolId !== "") {
    const defaultPool = computePools.find((pool) => pool.id === defaultComputePoolId);
    if (defaultPool && !focusedPools.some((pool) => pool.id === defaultComputePoolId)) {
      focusedPools.push(defaultPool);
    }
  }

  // Remove the focused pool(s) from their current position(s) in computePools and add them to the front.
  // (First reverse the focusedPools so that when we unshift them in order, they maintain their order, otherwise
  // if has both a currentlySelectedPool and a default pool, the default would end up first always, contrary to the intent.)
  focusedPools.reverse();
  for (const focusedPool of focusedPools) {
    const focusedPoolIndex: number = computePools.findIndex((pool) => focusedPool.id === pool.id);
    if (focusedPoolIndex !== -1) {
      computePools.splice(focusedPoolIndex, 1);
      computePools.unshift(focusedPool!);
    }
  }
  let lastSeparator: string = "";
  for (const pool of computePools) {
    if (filterPredicate && !filterPredicate(pool)) {
      continue;
    }
    const environment: Environment | undefined = environments.find(
      (env) => env.id === pool.environmentId,
    );
    if (!environment) {
      logger.warn(`No environment found for Flink compute pool "${pool.name}"`);
      return;
    }
    const isCurrentlySelectedPool = pool.id === initiallySelectedPool?.id;
    // show a separator by environment to make it easier to differentiate between the connection types
    // and make it clear which environment the pool(s) are associated with
    const connectionLabel = getConnectionLabel(environment.connectionType);
    // if the connection label is the same as the environment name, only show one
    const separatorLabel =
      connectionLabel === environment.name
        ? connectionLabel
        : `${connectionLabel}: ${environment.name}`;
    if (lastSeparator !== separatorLabel) {
      items.push({
        kind: QuickPickItemKind.Separator,
        label: separatorLabel,
      });
      lastSeparator = separatorLabel;
    }
    // Indicate the currently-focused pool, if there is one, with a 'selected' icon.
    const icon = isCurrentlySelectedPool ? IconNames.CURRENT_RESOURCE : pool.iconName;
    items.push({
      label: pool.name,
      description: pool.id,
      iconPath: new ThemeIcon(icon),
      value: pool,
    });
  }

  // prompt the user to select a Flink compute pool
  const chosenItem: QuickPickItemWithValue<CCloudFlinkComputePool> | undefined =
    await window.showQuickPick(items, {
      placeHolder: "Select a Flink compute pool",
      ignoreFocusOut: true,
    });
  return chosenItem ? chosenItem.value : undefined;
}
