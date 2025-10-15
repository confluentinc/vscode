import type { CancellationToken } from "vscode";
import type { ContainerInspectResponse } from "../../../src/clients/docker";
import { DEFAULT_DOCKER_NETWORK } from "../../../src/docker/constants";
import type { KafkaBrokerConfig } from "../../../src/docker/workflows/confluent-local";

// this should be moved even further up if needed for more tests
export const TEST_CANCELLATION_TOKEN: CancellationToken = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose: () => {} }),
};

export const TEST_BROKER_CONFIGS: KafkaBrokerConfig[] = [
  {
    brokerNum: 1,
    containerName: "test-vscode-confluent-broker-1",
    ports: { plainText: 9092, broker: 9093, controller: 9094 },
  },
  {
    brokerNum: 2,
    containerName: "test-vscode-confluent-broker-2",
    ports: { plainText: 9095, broker: 9096, controller: 9097 },
  },
];

export const TEST_KAFKA_CONTAINERS: ContainerInspectResponse[] = TEST_BROKER_CONFIGS.map(
  (config: KafkaBrokerConfig) => {
    return {
      Id: `${config.brokerNum}`,
      Name: config.containerName,
      Config: {
        Env: [
          `KAFKA_LISTENERS=PLAINTEXT://${config.containerName}:${config.ports.broker},CONTROLLER://${config.containerName}:${config.ports.controller},PLAINTEXT_HOST://${config.containerName}:${config.ports.plainText}`,
        ],
      },
      NetworkSettings: {
        Networks: {
          [DEFAULT_DOCKER_NETWORK]: {},
        },
      },
    };
  },
);
