import type { SelectFlinkDatabase } from "../objects/views/FlinkDatabaseView";

/** Configuration for creating a Flink artifact. */
export interface ArtifactConfig {
  /** Path to the JAR file. Defaults to the `udfs-simple.jar` fixture. */
  jarPath?: string;
  /** Entrypoint for uploading. Defaults to {@linkcode SelectFlinkDatabase.FromDatabaseViewButton}. */
  entrypoint?: SelectFlinkDatabase;
  /** Cloud provider; if both `provider` and `region` are set, the upload skips the entrypoint flow. */
  provider?: string;
  /** Cloud region; if both `provider` and `region` are set, the upload skips the entrypoint flow. */
  region?: string;
}
