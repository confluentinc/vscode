import { JSONSchema } from "vscode-json-languageservice";

export const PRODUCE_MESSAGE_SCHEMA: JSONSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "produce-message.schema",
  title: "Produce Message",
  description: "Schema for producing messages to a Kafka topic",
  oneOf: [
    { $ref: "#/definitions/produceMessage" },
    {
      type: "array",
      items: { $ref: "#/definitions/produceMessage" },
    },
  ],
  definitions: {
    produceMessage: {
      type: "object",
      properties: {
        key: {
          oneOf: [{ type: "string" }, { type: "object" }],
          description: "The key of the message",
        },
        value: {
          oneOf: [{ type: "string" }, { type: "object" }],
          description: "The value of the message",
        },
        headers: {
          type: "array",
          items: {
            type: "object",
            properties: {
              key: {
                type: "string",
                description: "The key of the header",
              },
              value: {
                type: "string",
                description: "The value of the header",
              },
            },
            required: ["key", "value"],
          },
        },
      },
      required: ["key", "value"],
    },
  },
};
