import { Data } from "dataclass";
import { ConnectionType } from "../clients/sidecar";
import { IconNames } from "../constants";

export type ConnectionId = string & { readonly brand: unique symbol };

export class ResourceBase extends Data {
  connectionId!: ConnectionId;
  connectionType!: ConnectionType;
  /** How this resource should be represented as a {@link TreeItem} or {@link QuickPickItem}. */
  iconName!: IconNames;

  /** Prefix for a `contextValue` for this resource, based on the {@link ConnectionType}. */
  get contextPrefix(): string {
    return this.connectionType.toLowerCase();
  }

  get isLocal(): boolean {
    return this.connectionType === ConnectionType.Local;
  }
  get isCCloud(): boolean {
    return this.connectionType === ConnectionType.Ccloud;
  }
  get isDirect(): boolean {
    return this.connectionType === ConnectionType.Direct;
  }
}
