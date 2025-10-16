import type { SubjectNameStrategy } from "../../diagnostics/produceMessage";
import type { Schema } from "../../models/schema";

export interface ProduceMessageSchemaOptions {
  keySchema?: Schema;
  valueSchema?: Schema;
  keySubjectNameStrategy?: SubjectNameStrategy;
  valueSubjectNameStrategy?: SubjectNameStrategy;
}
