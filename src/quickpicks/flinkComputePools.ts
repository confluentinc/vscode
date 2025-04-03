import { commands, QuickPickItemKind, ThemeIcon, window } from "vscode";
import { CCLOUD_SIGN_IN_BUTTON_LABEL } from "../authn/constants";
import { IconNames } from "../constants";
import { ContextValues, getContextValue } from "../context/values";
import { showInfoNotificationWithButtons } from "../errors";
import { getEnvironments } from "../graphql/environments";
import { Logger } from "../logging";
import { Environment } from "../models/environment";
import { FlinkComputePool } from "../models/flinkComputePool";
import { getConnectionLabel, isCCloud } from "../models/resource";
import { FlinkArtifactsViewProvider } from "../viewProviders/flinkArtifacts";
import { FlinkStatementsViewProvider } from "../viewProviders/flinkStatements";
import { QuickPickItemWithValue } from "./types";

const logger = new Logger("quickpicks.flinkComputePools");

/** Wrapper for the Flink Compute Pool quickpick to accomodate data-fetching time and display a
 * progress indicator on the Resources or Flink Statements/Artifacts view(s). */
export async function flinkComputePoolQuickPickWithViewProgress(
  viewId: "confluent-resources" | "confluent-flink-statements" | "confluent-flink-artifacts",
): Promise<FlinkComputePool | undefined> {
  return await window.withProgress(
    {
      location: { viewId },
      title: "Loading Flink compute pools...",
    },
    async () => {
      return await flinkComputePoolQuickPick();
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
 */
export async function flinkComputePoolQuickPick(): Promise<FlinkComputePool | undefined> {
  // TODO: implement and use ResourceLoader methods
  const environments: Environment[] = await getEnvironments();
  const computePools: FlinkComputePool[] = [];
  for (const env of environments) {
    if (env.flinkComputePools) {
      computePools.push(...env.flinkComputePools);
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
  const items: QuickPickItemWithValue<FlinkComputePool>[] = [];

  // if any pools are focused in the Statements/Artifacts views, move them to the top of the list
  const focusedPools: FlinkComputePool[] = [];
  const statementsPool: FlinkComputePool | null =
    FlinkStatementsViewProvider.getInstance().computePool;
  if (statementsPool) {
    focusedPools.push(statementsPool);
  }
  const artifactsPool: FlinkComputePool | null =
    FlinkArtifactsViewProvider.getInstance().computePool;
  if (artifactsPool) {
    focusedPools.push(artifactsPool);
  }
  for (const focusedPool of focusedPools) {
    const focusedPoolIndex: number = computePools.findIndex((pool) => focusedPool.id === pool.id);
    if (focusedPoolIndex !== -1) {
      computePools.splice(focusedPoolIndex, 1);
      computePools.unshift(focusedPool!);
    }
  }
  const focusedPoolIds: string[] = focusedPools.map((pool) => pool.id);

  let lastSeparator: string = "";
  for (const pool of computePools) {
    const environment: Environment | undefined = environments.find(
      (env) => env.id === pool.environmentId,
    );
    if (!environment) {
      logger.warn(`No environment found for Flink compute pool "${pool.name}"`);
      return;
    }
    const isFocusedPool = focusedPoolIds.includes(pool.id);
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
    // show the currently-focused pool, if there is one
    const icon = isFocusedPool ? IconNames.CURRENT_RESOURCE : pool.iconName;
    items.push({
      label: pool.name,
      description: pool.id,
      iconPath: new ThemeIcon(icon),
      value: pool,
    });
  }

  // prompt the user to select a Flink compute pool
  const chosenItem: QuickPickItemWithValue<FlinkComputePool> | undefined =
    await window.showQuickPick(items, {
      placeHolder: "Select a Flink compute pool",
      ignoreFocusOut: true,
    });
  return chosenItem ? chosenItem.value : undefined;
}
