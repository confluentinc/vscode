import type { ThemeIcon } from "vscode";
import { ConnectionType } from "../../clients/sidecar";
import { CCLOUD_CONNECTION_ID } from "../../constants";
import type { FlinkArtifact } from "../flinkArtifact";
import type { FlinkDatabaseResource } from "../flinkDatabaseResource";
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
  protected readonly loggerNamePrefix = "FlinkDatabaseResourceContainer";

  constructor(label: string, children: T[], contextValue?: string, icon?: ThemeIcon) {
    // Flink Database resources are always for the CCLOUD connection
    super(CCLOUD_CONNECTION_ID, ConnectionType.Ccloud, label, children, contextValue, icon);
  }
}
