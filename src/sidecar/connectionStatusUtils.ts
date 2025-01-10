// helpers for connection status testing, factored out for test spying

import { Connection, ConnectionType } from "../clients/sidecar/models";
import { Logger } from "../logging";

const logger = new Logger("connectionStatusUtils");

export function isConnectionStable(connection: Connection): boolean {
  const type = connection.spec.type!;

  switch (type) {
    case ConnectionType.Ccloud:
      return isCCloudConnectionStable(connection);
    case ConnectionType.Direct:
      return isDirectConnectionStable(connection);
    default:
      logger.warn(`isConnectionStable: unhandled connection type ${type}`);
      throw new Error(`Unhandled connection type ${type}`);
  }
}

function isCCloudConnectionStable(connection: Connection): boolean {
  const ccloudStatus = connection.status.ccloud!;
  const ccloudState = ccloudStatus.state;

  const ccloudFailed = ccloudStatus.errors?.sign_in?.message;
  if (ccloudFailed) {
    logger.error(`isCCloudConnectionStable(): error: ${ccloudFailed}`);
  }

  const rv = ccloudState !== "NONE";
  logger.debug(`isCCloudConnectionStable(): returning ${rv} based on state ${ccloudState}`);

  return rv;
}

function isDirectConnectionStable(connection: Connection): boolean {
  const status = connection.status;

  for (const [entity, maybeError] of [
    ["kafka", status.kafka_cluster?.errors?.sign_in?.message],
    ["schema registry", status.schema_registry?.errors?.sign_in?.message],
  ] as [string, string | undefined][]) {
    if (maybeError) {
      logger.error(`isDirectConnectionStable(): ${entity} error: ${maybeError}`);
    }
  }

  const kafkaState = status.kafka_cluster?.state;
  const schemaRegistryState = status.schema_registry?.state;

  const rv = kafkaState !== "ATTEMPTING" && schemaRegistryState !== "ATTEMPTING";
  logger.debug(
    `isDirectConnectionStable(): returning ${rv} for connection ${connection.id} based on kafkaState ${kafkaState} and schemaRegistryState ${schemaRegistryState}`,
  );

  return rv;
}
