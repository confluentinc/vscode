import { ConnectionType } from "../clients/sidecar";
import { CCLOUD_CONNECTION_ID, IconNames, LOCAL_CONNECTION_ID } from "../constants";

/** A uniquely-branded string-type for a connection ID. */
export type ConnectionId = string & { readonly brand: unique symbol };

/** Given a ConnectionId, return the corresponding ConnectionType */
export function connectionTypeFromId(id: ConnectionId): ConnectionType {
  // CCloud and local are defined by constants. Direct are then arbitrary uuid strings.
  return id === CCLOUD_CONNECTION_ID
    ? ConnectionType.Ccloud
    : id === LOCAL_CONNECTION_ID
      ? ConnectionType.Local
      : ConnectionType.Direct;
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
