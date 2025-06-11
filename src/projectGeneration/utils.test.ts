import * as assert from "assert";
import * as utils from "./utils";

describe("filterSensitiveKeys", () => {
  it("filters out keys containing 'key' or 'secret'", () => {
    const input = {
      // minimal valid ScaffoldV1Template shape
      metadata: {
        self: null,
      },
      spec: {
        name: "test-template",
        display_name: "Test Template",
        description: "A template for testing purposes",
        version: "1.0.0",
        options: {
          api_key: {
            initial_value: "sensitive",
            display_name: "API Key",
            description: "The API key for authentication",
          },
          secret_token: {
            initial_value: "sensitive",
            display_name: "Secret Token",
            description: "The secret token for authentication",
          },
          bootstrap_server: {
            initial_value: "localhost:9092",
            display_name: "Bootstrap Server",
            description: "The Kafka bootstrap server",
          },
          topic_name: {
            initial_value: "test-topic",
            display_name: "Topic Name",
            description: "The name of the Kafka topic",
          },
        },
      },
    };

    const result = utils.sanitizeTemplateOptions(input);

    assert.deepStrictEqual(
      result,
      {
        metadata: {
          self: null,
        },
        spec: {
          name: "test-template",
          display_name: "Test Template",
          description: "A template for testing purposes",
          version: "1.0.0",
          options: {
            bootstrap_server: {
              initial_value: "localhost:9092",
              display_name: "Bootstrap Server",
              description: "The Kafka bootstrap server",
            },
            topic_name: {
              initial_value: "test-topic",
              display_name: "Topic Name",
              description: "The name of the Kafka topic",
            },
            api_key: {
              initial_value: "********",
              display_name: "API Key",
              description: "The API key for authentication",
            },
            secret_token: {
              initial_value: "********",
              display_name: "Secret Token",
              description: "The secret token for authentication",
            },
          },
        },
      },
      "Should mask sensitive keys while preserving others",
    );
  });
});
