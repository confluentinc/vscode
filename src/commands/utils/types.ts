import { SubjectNameStrategy } from "../../diagnostics/produceMessage";
import { Schema } from "../../models/schema";

export interface ProduceMessageSchemaOptions {
  keySchema?: Schema;
  valueSchema?: Schema;
  keySubjectNameStrategy?: SubjectNameStrategy;
  valueSubjectNameStrategy?: SubjectNameStrategy;
}
