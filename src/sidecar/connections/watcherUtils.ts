// helpers for connection status testing, factored out for test spying

import { reactToCCloudAuthState } from "../../authn/ccloudStateHandling";
import { Connection, ConnectionType } from "../../clients/sidecar/models";
import { connectionStable, directConnectionCreated, environmentChanged } from "../../emitters";
import { Logger } from "../../logging";
import { ConnectionId, EnvironmentId } from "../../models/resource";
import { ConnectionEventBody } from "../../ws/messageTypes";

const logger = new Logger("sidecar.connections.statusUtils");

/**
 * Perform side-effects in the UI based on the the connection action (CREATED, DELETED, CONNECTED, etc.)
 * and connection type pairing. Will be called whenever we recieve a connection state update websocket
 * message from the sidecar.
 * @param event The connection event to handle
 */
export function connectionEventHandler(event: ConnectionEventBody) {
  const type = event.connection.spec.type!;
  const connection = event.connection;
  const id = connection.id as ConnectionId;

  // triage across the connection type, then call into
  // the appropriate very specific handler clause.
  switch (type) {
    case ConnectionType.Direct: {
      const environmentId = connection.id as EnvironmentId;
      switch (event.action) {
        case "CREATED":
        case "UPDATED":
        case "CONNECTED":
          if (event.action === "CREATED" || event.action === "UPDATED") {
            // Not yet terminal state connections are allowed to be thought to be in the process of being
            // created, so should show as "loading" in the UI if have no assciated clusters yet.
            directConnectionCreated.fire(id);
          }

          if (isDirectConnectionStable(connection)) {
            logger.info(
              `connectionEventHandler: direct connection ${event.action} ${connection.id} stable side effects firing.`,
            );
            // Fire when a direct connection is 'stable', be it happy or broken. Stops the loading spinny.
            connectionStable.fire(id);
            // notify subscribers that the "environment" has changed since direct connections are treated
            // as environment-specific resources
            environmentChanged.fire({ id: environmentId, wasDeleted: false });
          } else {
            logger.info(
              `connectionEventHandler: direct connection ${event.action} ${connection.id} not stable, not firing stable side-effects.`,
            );
          }
          break;
        case "DELETED":
        case "DISCONNECTED":
          //  James guessing here, seems appropriate.
          logger.info(
            `connectionEventHandler: direct connection ${event.action} ${connection.id} disconnected/deleted side effects firing.`,
          );
          // Stop any loading spinny...
          connectionStable.fire(id);
          // ???
          environmentChanged.fire({ id: environmentId, wasDeleted: true });
          break;
        default:
          logger.warn(`connectionEventHandler: unhandled ccloud connection action ${event.action}`);
          throw new Error(`Unhandled ccloud connection action ${event.action}`);
      }
      break;
    }
    case ConnectionType.Ccloud:
      switch (event.action) {
        case "CREATED":
        case "UPDATED":
        case "CONNECTED":
        case "DISCONNECTED":
          logger.debug(
            "connectionEventHandler: ccloud connection update received, passing to reactToCCloudAuthState()",
          );
          reactToCCloudAuthState(connection).catch((e) => {
            logger.error(`connectionEventHandler: reactToCCloudAuthState() failed: ${e}`, e.stack);
          });
          break;
        case "DELETED":
          // When a DELETED event comes, it will come with the prior (perhaps fully happy) spelling of the connection.
          // We don't want to consider it anymore, so don't call reactToCCloudAuthState.
          // (Other actions hinging off of a secret being deleted will cause us to cascade through
          // to have us go to a not-ccloud-authenticated state, so this is fine.)
          logger.debug("connectionEventHandler: ccloud connection deleted.");
          break;
        default:
          logger.warn(`connectionEventHandler: unhandled ccloud connection action ${event.action}`);
          throw new Error(`Unhandled ccloud connection action ${event.action}`);
      }
      break;

    case ConnectionType.Local:
      logger.info(
        `connectionEventHandler: ${connection.id} connection ${event.action} side effects unhandled.`,
      );
      break;
    default:
      logger.warn(`connectionEventHandler: unhandled connection type ${type}`);
      throw new Error(`Unhandled connection type ${type}`);
  }
}

export function isConnectionStable(event: ConnectionEventBody): boolean {
  // TODO: Consider including the event.action, like DELETED, UPDATED. etc?

  const connection = event.connection;
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
