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
        value: {
          description: "The value of the message",
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
  },
};
