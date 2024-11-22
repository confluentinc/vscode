import { ConnectionType } from "../clients/sidecar";
import { IconNames } from "../constants";

/** A uniquely-branded string-type for a connection ID. */
export type ConnectionId = string & { readonly brand: unique symbol };

export interface IResourceBase {
  connectionId: ConnectionId;
  connectionType: ConnectionType;
  /** How this resource should be represented as a {@link TreeItem} or {@link QuickPickItem}. */
  iconName: IconNames;
}

export function isLocal(resource: IResourceBase): boolean {
  return resource.connectionType === ConnectionType.Local;
}

export function isCCloud(resource: IResourceBase): boolean {
  return resource.connectionType === ConnectionType.Ccloud;
}

export function isDirect(resource: IResourceBase): boolean {
  return resource.connectionType === ConnectionType.Direct;
}
