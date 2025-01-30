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

export interface ISearchable {
  /** Space-separated strings for a given resource that should be searchable in the UI. */
  searchableText: () => string;
}

export function isSearchable(item: any): item is ISearchable {
  return "searchableText" in item;
}
