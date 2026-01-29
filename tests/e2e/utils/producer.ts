import { KafkaJS } from "@confluentinc/kafka-javascript";
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { DEBUG_LOGGING_ENABLED } from "../constants";
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
    compressionType = KafkaJS.CompressionTypes.None,
    keyPrefix = "test-key",
    valuePrefix = "test-value",
  } = options;

  const messages = Array.from({ length: numMessages }, (_, i) => ({
    key: `${keyPrefix}-${i}`,
    value: `${valuePrefix}-${i}`,
  }));

  let bootstrapServers: string;
  let saslConfig: KafkaJS.SASLOptions | undefined;
  if (connectionType === ConnectionType.LOCAL) {
    // copy the bootstrap server from the Resources view for LOCAL connections since we don't have
    // to set up any local credentials
    const resourcesView = new ResourcesView(page);
    const localKafka = await resourcesView.getKafkaCluster(ConnectionType.LOCAL);
    await expect(localKafka).not.toHaveCount(0);
    const localKafkaItem = new KafkaClusterItem(page, localKafka.first());
    bootstrapServers = await localKafkaItem.copyBootstrapServers();
  } else {
    // CCLOUD and DIRECT connections will use the same bootstrap servers and auth mechanism unless
    // otherwise specified by the tests
    bootstrapServers =
      directConnectionConfig?.kafkaConfig?.bootstrapServers ??
      process.env.E2E_KAFKA_BOOTSTRAP_SERVERS!;
    if (
      directConnectionConfig?.kafkaConfig &&
      directConnectionConfig.kafkaConfig.authType !== SupportedAuthType.None
    ) {
      const credentials = directConnectionConfig.kafkaConfig.credentials;
      saslConfig = {
        mechanism: "plain",
        username: credentials.api_key || credentials.username,
        password: credentials.api_secret || credentials.password,
      };
    }
  }

  const kafkaConfig: KafkaJS.KafkaConfig = {
    ssl: connectionType !== ConnectionType.LOCAL,
    brokers: bootstrapServers.split(","),
    logLevel: KafkaJS.logLevel.ERROR, // silence non-error logging
  };
  if (saslConfig) {
    kafkaConfig.sasl = saslConfig;
  }

  const kafka = new KafkaJS.Kafka({ kafkaJS: kafkaConfig });
  const producer = kafka.producer({ "compression.codec": compressionType });

  try {
    await producer.connect();
    await producer.send({
      topic: topicName,
      messages,
    });
    if (DEBUG_LOGGING_ENABLED) {
      console.debug(`Produced ${numMessages} message(s) to topic '${topicName}'`, {
        connectionType,
      });
    }
    await producer.flush({ timeout: 5000 });
  } catch (error) {
    console.error("Error producing messages:", error);
    throw error;
  } finally {
    await producer.disconnect();
  }
}
