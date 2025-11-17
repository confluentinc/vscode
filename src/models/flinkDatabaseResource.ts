import type { FlinkAIModel } from "./flinkAiModel";
import type { FlinkRelation } from "./flinkRelation";
import type { FlinkUdf } from "./flinkUDF";

/** Union type for all resources that can belong to a Flink database. */
export type FlinkDatabaseResource = FlinkUdf | FlinkRelation | FlinkAIModel;
