import { JSONSchema } from "vscode-json-languageservice";

export const PRODUCE_MESSAGE_SCHEMA: JSONSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "produce-message.schema",
  title: "Produce Message",
  description: "Schema for producing messages to a Kafka topic",
  oneOf: [
    // NOTE: the ordering here is important -- if the object is first, validating an empty array
    // will raise a confusing error about expecting an object type and not "Array has too few items"
    {
      type: "array",
      items: { $ref: "#/definitions/produceMessage" },
      minItems: 1,
    },
    { $ref: "#/definitions/produceMessage" },
  ],
  definitions: {
    produceMessage: {
      type: "object",
      properties: {
        key: {
          description: "The key of the message",
        },
        key_schema: {
          $ref: "#/definitions/schemaInfo",
        },
        value: {
          description: "The value of the message",
        },
        value_schema: {
          $ref: "#/definitions/schemaInfo",
        },
        headers: {
          type: "array",
          items: {
            type: "object",
            properties: {
              // either name or key is required, but 'name' is used in the request interface
              name: {
                description: "The name of the header",
              },
              key: {
                type: "string",
                description: "The key of the header",
              },
              value: {
                type: "string",
                description: "The value of the header",
              },
            },
            required: ["value"],
            oneOf: [{ required: ["key"] }, { required: ["name"] }],
          },
        },
        partition_id: {
          type: "integer",
          description: "The partition to produce to",
        },
        timestamp: {
          type: "integer",
          description: "The timestamp of the message in milliseconds since epoch",
        },
      },
      required: ["key", "value"],
    },
    schemaInfo: {
      type: "object",
      properties: {
        // TODO: add Schema Registry URI?
        schema_version: {
          type: "integer",
          description: "The version number of the schema",
        },
        subject: {
          type: "string",
          description: "The subject of the schema",
        },
        subject_name_strategy: {
          type: "string",
          description: "The subject name strategy",
          enum: ["TOPIC_NAME", "RECORD_NAME", "TOPIC_RECORD_NAME"],
        },
      },
      required: ["schema_version", "subject", "subject_name_strategy"],
    },
  },
};

export interface ProduceMessage {
  key?: string;
  key_schema?: SchemaInfo;
  value?: string;
  value_schema?: SchemaInfo;
  headers?: MessageHeader[];
  partition_id?: number;
  timestamp?: number;
}

export interface SchemaInfo {
  // TODO: add Schema Registry URI?
  schema_version: number;
  subject: string;
  subject_name_strategy: "TOPIC_NAME" | "RECORD_NAME" | "TOPIC_RECORD_NAME" | undefined;
  type: "BINARY" | "JSON" | "STRING" | undefined;
}

export interface MessageHeader {
  name?: string;
  key?: string;
  value: string;
}
