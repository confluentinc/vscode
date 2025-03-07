import { Schema } from "../../models/schema";
import { SubjectNameStrategy } from "../../schemas/produceMessageSchema";

export interface ProduceMessageSchemaOptions {
  keySchema?: Schema;
  valueSchema?: Schema;
  keySubjectNameStrategy?: SubjectNameStrategy;
  valueSubjectNameStrategy?: SubjectNameStrategy;
}
