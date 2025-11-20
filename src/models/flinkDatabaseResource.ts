import type { FlinkAIConnection } from "./flinkAiConnection";
import type { FlinkAIModel } from "./flinkAiModel";
import type { FlinkUdf } from "./flinkUDF";

/** Union type for resources with a Flink database parent. */
export type FlinkDatabaseResource = FlinkUdf | FlinkAIModel | FlinkAIConnection;
