import type { FlinkAIAgent } from "./flinkAiAgent";
import type { FlinkAIConnection } from "./flinkAiConnection";
import type { FlinkAIModel } from "./flinkAiModel";
import type { FlinkAITool } from "./flinkAiTool";
import type { FlinkRelation } from "./flinkRelation";
import type { FlinkUdf } from "./flinkUDF";

/** Union type for all Flink AI resources. */
export type FlinkAIResource = FlinkAIModel | FlinkAIConnection | FlinkAITool | FlinkAIAgent;

/** Union type for top-level resources with a Flink database parent. */
export type FlinkDatabaseResource = FlinkRelation | FlinkUdf | FlinkAIResource;
