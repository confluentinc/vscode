import { ProduceRequestData } from "../../clients/sidecar";
import { Schema } from "../../models/schema";
import {
  ProduceMessage,
  SchemaInfo,
  SubjectNameStrategy,
} from "../../schemas/produceMessageSchema";
import { ProduceMessageSchemaOptions } from "./types";

/** Create the {@link ProduceRequestData} objects for the `key` and `value` of a produce request based on the provided `message` content and any schema options. */
export async function createProduceRequestData(
  message: ProduceMessage,
  schemaOptions: ProduceMessageSchemaOptions = {},
): Promise<{ keyData: ProduceRequestData; valueData: ProduceRequestData }> {
  // snake case since this is coming from a JSON document:
  const { key, value, key_schema, value_schema } = message;
  // user-selected schema information via settings and quickpicks
  const { keySchema, keySubjectNameStrategy, valueSchema, valueSubjectNameStrategy } =
    schemaOptions;

  // message-provided schema information takes precedence over quickpicked schema
  const keySchemaData: SchemaInfo | undefined = extractSchemaInfo(
    key_schema,
    keySchema,
    keySubjectNameStrategy,
  );
  const keyData: ProduceRequestData = {
    ...(keySchemaData ?? {}),
    data: key,
  };
  const valueSchemaData: SchemaInfo | undefined = extractSchemaInfo(
    value_schema,
    valueSchema,
    valueSubjectNameStrategy,
  );
  const valueData: ProduceRequestData = {
    ...(valueSchemaData ?? {}),
    data: value,
  };
  return { keyData, valueData };
}

/**
 * Extract schema information from provided produce-message content, or a {@link Schema}. Returns
 * the necessary {@link SchemaInfo} object for the produce request.
 */
export function extractSchemaInfo(
  schemaInfo: any,
  schema: Schema | undefined,
  subjectNameStrategy: SubjectNameStrategy | undefined,
): SchemaInfo | undefined {
  if (!(schemaInfo || schema)) {
    return;
  }
  const schema_version = schemaInfo?.schema_version ?? schema?.version;
  const subject = schemaInfo?.subject ?? schema?.subject;
  const subject_name_strategy =
    schemaInfo?.subject_name_strategy ?? subjectNameStrategy ?? "TOPIC_NAME";

  // drop type since the sidecar rejects this with a 400
  return { schema_version, subject, subject_name_strategy };
}
