import type { Disposable, EventEmitter, TreeDataProvider } from "vscode";
import type { ContextValues } from "../../context/values";
import { setContextValue } from "../../context/values";
import { ccloudConnected } from "../../emitters";
import { ResourceLoader } from "../../loaders";
import type { Environment } from "../../models/environment";
import type { EnvironmentId } from "../../models/resource";
import { isCCloud } from "../../models/resource";
import type { BaseViewProviderData, RefreshableTreeViewProvider } from "./base";
import { BaseViewProvider } from "./base";

/**
 * Type describing 'focused parent' types for ParentedBaseViewProvider,
 * namely things which either are or come from a single Environment.
 */
export type EnvironmentedBaseViewProviderData = BaseViewProviderData & {
  environmentId: EnvironmentId;
};

/**
 * Base class for all tree view providers handling a primary resource type and a parent resource.
 * @template P The type of the "parent" resource that can be "focused" in the view to determine which
 * resources will be shown. (Example: `KafkaCluster`, `SchemaRegistry`, `FlinkComputePool`)
 * @template T The primary resource(s) that will be shown in the view.
 */
export abstract class ParentedBaseViewProvider<
    P extends EnvironmentedBaseViewProviderData,
    T extends BaseViewProviderData,
  >
  extends BaseViewProvider<T>
  implements TreeDataProvider<T>, RefreshableTreeViewProvider
{
  /**
   * The focused 'parent' resource instance associated with this provider.
   *
   * Examples:
   * - Topics view: `KafkaCluster`
   * - Schemas view: `SchemaRegistry`
   * - Flink Statements view: `FlinkComputePool`
   * - Flink Databases view: `KafkaCluster` (as Flink database)
   */
  resource: P | null = null;
  /**
   * Required {@link EventEmitter} to listen for when this view provider's parent
   * {@linkcode resource} is set/unset. This is used in order to control the tree view description,
   * context value, and search string updates internally.
   */
  parentResourceChangedEmitter!: EventEmitter<P | null>;

  /** Optional boolean context value to adjust when the parent {@linkcode resource} is set/unset. */
  parentResourceChangedContextValue?: ContextValues;

  /**
   * Set the parent resource for this view provider. If being set to what is already set, the
   * resource will be refreshed.
   *
   * @returns A promise that resolves when the resource is set and any reloads are complete.
   */
  async setParentResource(resource: P | null): Promise<void> {
    this.logger.debug(`setParentResource() called, ${resource ? "refreshing" : "resetting"}.`, {
      resource,
    });

    const promises: Promise<unknown>[] = [];

    if (
      this.resource?.id !== resource?.id ||
      this.resource?.connectionId !== resource?.connectionId
    ) {
      this.setSearch(null); // reset search when parent resource changes

      // If we have a boolean context value to adjust, and if the boolean value is changing, adjust it.
      if (this.parentResourceChangedContextValue && Boolean(resource) !== Boolean(this.resource)) {
        promises.push(setContextValue(this.parentResourceChangedContextValue, Boolean(resource)));
      }

      this.resource = resource;
    }

    // Be sure to only kick off the awaitables _after_ we've assigned this.resource,
    // since they depend on it.

    promises.push(
      // Always refresh the view when parent resource changes.
      this.refresh(),
      // Update the tree view description to show the parent environment name and resource ID.
      this.updateTreeViewDescription(),
    );

    await Promise.all(promises);
  }

  /** Set up event listeners for this view provider. */
  protected setEventListeners(): Disposable[] {
    const disposables: Disposable[] = super.setEventListeners();

    disposables.push(
      // If parent resource was ccloud-based, and if ccloud auth status changes, reset the view.
      ccloudConnected.event(this.ccloudConnectedHandler.bind(this)),
      // When the parent resource changes (actual event emitter varying per subclass), capture and react to it.
      this.parentResourceChangedEmitter.event(this.setParentResource.bind(this)),
    );

    return disposables;
  }

  /** Event handler for when CCloud connection gets logged out: If the view was focused on a ccloud resource, reset the view. */
  ccloudConnectedHandler(connected: boolean): void {
    if (!connected && this.resource && isCCloud(this.resource)) {
      // any transition of CCloud connection state should reset the tree view if we're focused on
      // a CCloud parent resource
      this.logger.debug("ccloudConnected event fired, resetting view", { connected });
      // Use setParentResource so all the right things happen, including context value adjustment.
      void this.setParentResource(null);
    }
  }

  async reset(): Promise<void> {
    this.resource = null;

    await super.reset();
  }

  /**
   * Update the tree view description to show the currently-focused {@linkcode resource}'s parent
   * {@link Environment} name and the resource ID.
   *
   * Reassigns {@linkcode environment} to the parent {@link Environment} of the {@linkcode resource}.
   * */
  async updateTreeViewDescription(): Promise<void> {
    const subLogger = this.logger.withCallpoint("updateTreeViewDescription");

    const focusedResource = this.resource;
    if (!focusedResource) {
      subLogger.debug("called with no focused resource, clearing view description");
      this.treeView.description = "";
      return;
    }

    subLogger.debug(
      `called with ${focusedResource.constructor.name}, checking for environments...`,
    );
    const parentEnv: Environment | undefined = await ResourceLoader.getEnvironment(
      focusedResource.connectionId,
      focusedResource.environmentId,
    );

    if (parentEnv) {
      subLogger.debug("found environment, setting view description");
      this.treeView.description = `${parentEnv.name} | ${focusedResource.id}`;
    } else {
      subLogger.debug(`couldn't find parent environment for ${focusedResource.constructor.name}`);
      this.treeView.description = "";
    }
  }
}
