import type { ThemeIcon } from "vscode";
import { ConnectionType } from "../../clients/sidecar";
import { CCLOUD_CONNECTION_ID } from "../../constants";
import type { FlinkArtifact } from "../flinkArtifact";
import type { FlinkDatabaseResource } from "../flinkDatabaseResource";
import type { ConnectionId } from "../resource";
import { ResourceContainer } from "./resourceContainer";

/** Labels for the top-level containers in the Flink Database view. */
export enum FlinkDatabaseContainerLabel {
  RELATIONS = "Tables and Views",
  ARTIFACTS = "Artifacts",
  UDFS = "UDFs",
  AI_CONNECTIONS = "Connections",
  AI_TOOLS = "AI Tools",
  AI_MODELS = "AI Models",
  AI_AGENTS = "AI Agents",
}

/** A container {@link TreeItem} for resources to display in the Flink Database view. */
export class FlinkDatabaseResourceContainer<
  T extends FlinkDatabaseResource | FlinkArtifact,
> extends ResourceContainer<T> {
  readonly connectionId: ConnectionId = CCLOUD_CONNECTION_ID;
  readonly connectionType: ConnectionType = ConnectionType.Ccloud;

  get loggerName() {
    return `models.FlinkDatabaseResourceContainer(${this.label})`;
  }

  constructor(label: string, children: T[], contextValue?: string, icon?: ThemeIcon) {
    super(label, children, contextValue, icon);

    this.id = `${CCLOUD_CONNECTION_ID}-${label}`;
  }
}
