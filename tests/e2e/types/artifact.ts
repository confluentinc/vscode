import type { SelectFlinkDatabase } from "../objects/views/FlinkDatabaseView";

/** Configuration for creating a Flink artifact. */
export interface ArtifactConfig {
  /** Path to the JAR file. Defaults to the `udfs-simple.jar` fixture. */
  jarPath?: string;
  /** Entrypoint for uploading. Defaults to FromDatabaseViewButton. */
  entrypoint?: SelectFlinkDatabase;
  /** Cloud provider. Defaults to "AWS". */
  provider?: string;
  /** Cloud region. Defaults to "us-east-2". */
  region?: string;
}
