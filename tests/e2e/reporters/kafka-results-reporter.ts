import { execSync } from "node:child_process";
import { type Reporter, type TestCase } from "@playwright/test/reporter";
import { KafkaJS } from "@confluentinc/kafka-javascript";
import {
  SchemaRegistryClient,
  SerdeType,
  AvroSerializer,
  type BasicAuthCredentials,
} from "@confluentinc/schemaregistry";
import { v4 as uuidv4 } from "uuid";

type Message = {
  timestamp: number;
  key: string;
  value: {
    location: string;
    title: string;
    outcome: "skipped" | "expected" | "unexpected" | "flaky";
    expectedStatus: "passed" | "failed" | "timedOut" | "skipped" | "interrupted";
    actualStatus: "passed" | "failed" | "timedOut" | "skipped" | "interrupted";
    semaphoreWorkflowId: string;
    duration: number;
    retries: number;
    platform: string;
  };
};

const configPath = "/stag/kv/frontend/e2e_kafka_reporter_credentials";

const srBaseUrl = vault<string>(configPath, "schemaRegistryBaseUrl");
const srBasicAuthCredentials = vault<BasicAuthCredentials>(
  configPath,
  "schemaRegistryBasicAuthCredentials",
);
const kafkaConfig = vault<KafkaJS.ProducerConstructorConfig>(configPath, "kafkaConfig");

const kafkaProducerConfig: KafkaJS.ProducerConstructorConfig = {
  ...kafkaConfig,
  "client.id": "playwright-kafka-reporter",
};

export default class KafkaReporter implements Reporter {
  messages: Message[] = [];

  schemaRegistryClient = new SchemaRegistryClient({
    baseURLs: [srBaseUrl],
    basicAuthCredentials: srBasicAuthCredentials,
  });

  keySerializer = new AvroSerializer(this.schemaRegistryClient, SerdeType.KEY, {
    useLatestVersion: true,
  });

  valueSerializer = new AvroSerializer(this.schemaRegistryClient, SerdeType.VALUE, {
    useLatestVersion: true,
  });

  kafkaProducer = new KafkaJS.Kafka().producer(kafkaProducerConfig);

  onTestEnd(test: TestCase) {
    if (
      test.expectedStatus === "passed" &&
      test.outcome() === "unexpected" &&
      test.results.length < test.retries + 1
    ) {
      // this is not the final result, test will be retried
      return;
    }

    const platform = test.annotations.find((annotation) => annotation.type === "platform");
    // picking final result to represent the test's status
    const result = test.results.at(-1);
    if (result == null) return;
    const [spec, ...title] = test.titlePath().slice(2);
    this.messages.push({
      timestamp: result.startTime.valueOf(),
      key: uuidv4(),
      value: {
        location: spec,
        title: title.join(" › "),
        outcome: test.outcome(),
        expectedStatus: test.expectedStatus,
        semaphoreWorkflowId: process.env.SEMAPHORE_WORKFLOW_ID ?? "missing",
        actualStatus: result.status,
        duration: result.duration,
        retries: result.retry,
        platform: platform?.description ?? "unknown",
      },
    });
  }

  async onEnd() {
    await this.kafkaProducer.connect();
    const topic = process.env.E2E_KAFKA_REPORTER_TOPIC;
    if (topic == null) {
      throw new Error("Kafka topic name required");
    }
    const messages = await Promise.all(
      this.messages.map(async ({ key, value, timestamp }) => {
        const serializedKey = await this.keySerializer.serialize(topic, key);
        const serializedValue = await this.valueSerializer.serialize(topic, value);
        return { key: serializedKey, value: serializedValue, timestamp: String(timestamp) };
      }),
    );
    await this.kafkaProducer.send({ topic, messages });
    await this.kafkaProducer.disconnect();
  }
}

function vault<T>(path: string, field: string): T {
  const stdout = execSync(`vault kv get --format json -field ${field} ${path}`, {
    env: process.env,
  }).toString();
  return JSON.parse(stdout);
}
