import { ConnectionType } from "../clients/sidecar";
import { CCLOUD_CONNECTION_ID, IconNames, LOCAL_CONNECTION_ID } from "../constants";

/** A uniquely-branded string-type for a connection ID. */
export type ConnectionId = string & { readonly brand: unique symbol };

/** Likewise for environment ids. Note that Direct Connection ids also double as environment ids. */
export type EnvironmentId = string & { readonly brand: unique symbol };

// Function to convert a ConnectionId to a ConnectionType, because we can always
// go from one to the other.
export function connectionIdToType(id: ConnectionId): ConnectionType {
  if (id === LOCAL_CONNECTION_ID) {
    return ConnectionType.Local;
  } else if (id === CCLOUD_CONNECTION_ID) {
    return ConnectionType.Ccloud;
  } else {
    // Otherwise is a UUID-based Direct connection
    return ConnectionType.Direct;
  }
}

// TODO: use other branded resource ID types here

export interface IResourceBase {
  connectionId: ConnectionId;
  connectionType: ConnectionType;
  /** How this resource should be represented as a {@link TreeItem} or {@link QuickPickItem}. */
  iconName?: IconNames;
}

export function isResource(value: any): value is IResourceBase {
  return value.connectionId !== undefined && value.connectionType !== undefined;
}

/** Does this resource come from a "local" connection? */
export function isLocal(resource: IResourceBase): boolean {
  return resource.connectionType === ConnectionType.Local;
}

/** Does this resource come from a Confluent Cloud connection? */
export function isCCloud(resource: IResourceBase): boolean {
  return resource.connectionType === ConnectionType.Ccloud;
}

/** Does this resource come from a "direct" connection? */
export function isDirect(resource: IResourceBase): boolean {
  return resource.connectionType === ConnectionType.Direct;
}

/** Human-readable {@link ConnectionTypes} labeling for the UI. */
export enum ConnectionLabel {
  LOCAL = "Local",
  CCLOUD = "Confluent Cloud",
  DIRECT = "Other", // TODO: update based on feedback from product+design
}

/** Get the human-readable label for the given connection type. */
export function getConnectionLabel(type: ConnectionType): string {
  switch (type) {
    case ConnectionType.Local:
      return ConnectionLabel.LOCAL;
    case ConnectionType.Ccloud:
      return ConnectionLabel.CCLOUD;
    case ConnectionType.Direct:
      return ConnectionLabel.DIRECT;
    default:
      throw new Error(`Unhandled connection type ${type}`);
  }
}

/** Specifies a (Ccloud) environment/provider/region tuple. */
export interface IEnvProviderRegion {
  environmentId: EnvironmentId;
  provider: string;
  region: string;
}

/**
 * Additional bits needed to make Flink API queries.
 **/
export interface IFlinkQueryable extends IEnvProviderRegion {
  /** The organization ID for the resource. */
  organizationId: string;
  /** Limit to a specific compute pool? */
  computePoolId?: string;
}

export interface ISearchable {
  /** Space-separated strings for a given resource that should be searchable in the UI. */
  searchableText: () => string;

  /** Any searchable child resources of this resource. */
  children?: ISearchable[];
}

export function isSearchable(item: any): item is ISearchable {
  if (!item) {
    return false;
  }
  return "searchableText" in item;
}

/** Extension of IResourceBase identifying a specific schema registry or resources derived from within. */
export interface ISchemaRegistryResource extends IResourceBase {
  readonly environmentId: EnvironmentId;
  readonly schemaRegistryId: string;
}
