import { KafkaJS } from "@confluentinc/kafka-javascript";
import type { ProducerConstructorConfig } from "@confluentinc/kafka-javascript/types/kafkajs";
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { ResourcesView } from "../objects/views/ResourcesView";
import { KafkaClusterItem } from "../objects/views/viewItems/KafkaClusterItem";
import type { DirectConnectionOptions } from "../types/connection";
import { ConnectionType, SupportedAuthType } from "../types/connection";
import type { ProducerOptions } from "../types/topic";

/**
 * Produces messages to a Kafka topic using the JavaScript Kafka client based on the connection type.
 *
 * This is required until the extension supports specifying a compression type through the produce-
 * message user flow.
 *
 * Special handling by connection type:
 * - For `CCLOUD` connections: Uses username/password from environment variables
 * - For `DIRECT` connections: Uses the same credentials as the connection's Kafka config
 * - For `LOCAL` connections: Copies the bootstrap server from the local Kafka cluster item
 *
 * @param page The Playwright Page instance for accessing clipboard and UI elements
 * @param connectionType The {@link ConnectionType connection type} being used
 * @param options Configuration {@link ProducerOptions options} for producing messages
 * @param directConnectionConfig Optional direct connection {@link DirectConnectionOptions config} when using a `DIRECT` connection
 */
export async function produceMessages(
  page: Page,
  connectionType: ConnectionType,
  topicName: string,
  options: ProducerOptions,
  directConnectionConfig?: DirectConnectionOptions,
): Promise<void> {
  const {
    numMessages = 10,
    compressionType,
    keyPrefix = "test-key",
    valuePrefix = "test-value",
  } = options;

  const messages = Array.from({ length: numMessages }, (_, i) => ({
    key: `${keyPrefix}-${i}`,
    value: `${valuePrefix}-${i}`,
  }));

  let bootstrapServers: string;
  let saslConfig: { mechanism?: string; username?: string; password?: string } = {};

  // get connection details based on connection type
  switch (connectionType) {
    case ConnectionType.Ccloud:
      // use the predefined CCloud username/password for SASL/PLAIN
      if (!process.env.E2E_USERNAME || !process.env.E2E_PASSWORD) {
        throw new Error(
          "E2E_USERNAME and E2E_PASSWORD environment variables must be set for CCloud producer",
        );
      }
      if (!process.env.E2E_KAFKA_BOOTSTRAP_SERVERS) {
        throw new Error(
          "E2E_KAFKA_BOOTSTRAP_SERVERS environment variable must be set for CCloud producer",
        );
      }
      bootstrapServers = process.env.E2E_KAFKA_BOOTSTRAP_SERVERS;
      saslConfig = {
        mechanism: "plain",
        username: process.env.E2E_USERNAME,
        password: process.env.E2E_PASSWORD,
      };
      break;

    case ConnectionType.Direct:
      // use the predefined Kafka config from the direct connection setup
      if (!directConnectionConfig || !directConnectionConfig.kafkaConfig) {
        throw new Error("Direct connection config with Kafka config must be provided");
      }
      bootstrapServers = directConnectionConfig.kafkaConfig.bootstrapServers;

      if (directConnectionConfig.kafkaConfig.authType !== SupportedAuthType.None) {
        const credentials = directConnectionConfig.kafkaConfig.credentials;
        saslConfig = {
          mechanism: "plain",
          username: credentials.api_key || credentials.username,
          password: credentials.api_secret || credentials.password,
        };
      }
      break;

    case ConnectionType.Local:
      // just copy the bootstrap server from the UI for local connections since we don't set up auth
      const resourcesView = new ResourcesView(page);
      const localKafka = await resourcesView.getKafkaCluster(ConnectionType.Local);
      await expect(localKafka).not.toHaveCount(0);
      const localKafkaItem = new KafkaClusterItem(page, localKafka.first());
      await localKafkaItem.copyBootstrapServers();
      bootstrapServers = await page.evaluate(async () => await navigator.clipboard.readText());
      break;

    default:
      throw new Error(`Unsupported connection type: ${connectionType}`);
  }

  const producerConfig: ProducerConstructorConfig = {
    "bootstrap.servers": bootstrapServers,
  };

  if (compressionType) {
    producerConfig["compression.codec"] = compressionType;
  }

  // set up credentials for CCLOUD/DIRECT connections
  if (Object.keys(saslConfig).length > 0) {
    producerConfig["security.protocol"] = "sasl_ssl";
    producerConfig["sasl.mechanisms"] = saslConfig.mechanism?.toUpperCase();
    producerConfig["sasl.username"] = saslConfig.username;
    producerConfig["sasl.password"] = saslConfig.password;
  }

  const kafka = new KafkaJS.Kafka();
  const producer = kafka.producer(producerConfig);

  try {
    await producer.connect();
    await producer.send({
      topic: topicName,
      messages,
    });
    await producer.flush({ timeout: 5000 });
  } finally {
    await producer.disconnect();
  }
}
