import type { AuthError, CCloudStatus, Connection } from "../connections";
import { ConnectedState } from "../connections";
import { observabilityContext } from "../context/observability";
import { ccloudAuthSessionInvalidated, stableCCloudConnectedState } from "../emitters";
import { Logger } from "../logging";
import {
  showErrorNotificationWithButtons,
  showInfoNotificationWithButtons,
} from "../notifications";
import { getResourceManager } from "../storage/resourceManager";
import { CCLOUD_SIGN_IN_BUTTON_LABEL } from "./constants";
import { getCCloudAuthSession } from "./utils";

const logger = new Logger("authn.ccloudStateHandling");

// labels for the buttons exposed by the notifications
export const REAUTH_BUTTON_TEXT = "Reauthenticate";

/**
 * Handler for when the sidecar pushes an update to the CCloud {@link Connection} to us via websocket event.
 * Checks mainly for different {@link Status} values and `errors` data:
 * - `NO_TOKEN`: User hasn't authenticated yet, all three tokens are not yet available, or session
 *      has expired (8-hour lifetime reached)
 * - `VALID_TOKEN`: Fully authenticated and operational
 * - `INVALID_TOKEN`: Tokens exist but API calls are failing (temporary issue)
 * - `FAILED`: Non-transient error requiring user intervention
 * - If any `errors` are non-transient, the user is prompted to reauthenticate.
 *
 * Additionally, any non-`ATTEMPTING` state will close any open progress notifications
 * that may have been opened by the middleware.
 */
export async function handleUpdatedConnection(connection: Connection): Promise<void> {
  const status: CCloudStatus | undefined = connection.status.ccloud;
  if (!status) {
    logger.warn("no CCloud status found in connection, skipping connected state handling");
    return;
  }

  const connectedState: ConnectedState = status.state;
  // check previously stored state for comparison later
  const resourceManager = getResourceManager();
  const previousState: ConnectedState | undefined = await resourceManager.getCCloudState();

  logger.debug("received update to CCloud connection", {
    currentState: connectedState,
    previousState,
    expiration: status.requiresAuthenticationAt,
    errors: status.errors,
  });

  // only update state tracking if it changed from the last event
  if (connectedState !== previousState) {
    observabilityContext.ccloudAuthLastSeenState = connectedState;
    await resourceManager.setCCloudState(connectedState);
    logger.debug(`CCloud connected state transition: ${previousState} -> ${connectedState}`);
  }

  if (connectedState !== ConnectedState.EXPIRED) {
    // ensure any open progress notifications are closed even if no requests are going through the middleware
    stableCCloudConnectedState.fire();
  }

  switch (connectedState) {
    case ConnectedState.SUCCESS:
    case ConnectedState.EXPIRED:
      // no action needed, just move on to checking for errors
      break;

    case ConnectedState.FAILED:
      // non-transient error that requires user intervention
      logger.warn("CCloud connection failed with non-transient error");
      ccloudAuthSessionInvalidated.fire();
      void showErrorNotificationWithButtons(
        "Error authenticating with Confluent Cloud. Please try again.",
        {
          [CCLOUD_SIGN_IN_BUTTON_LABEL]: async () =>
            await getCCloudAuthSession({ createIfNone: true }),
        },
      );
      break;

    case ConnectedState.NONE:
      // try to detect session expiration via transition from SUCCESS/EXPIRED to NONE
      // see https://github.com/confluentinc/ide-sidecar/blob/121dc766ab64bea1d88212f34f0084eb692ade4d/src/main/java/io/confluent/idesidecar/restapi/connections/CCloudConnectionState.java#L116-L122
      if (previousState === ConnectedState.SUCCESS || previousState === ConnectedState.EXPIRED) {
        ccloudAuthSessionInvalidated.fire();
        logger.debug("CCloud session expired, prompting for reauthentication");
        void showInfoNotificationWithButtons(
          "Your Confluent Cloud session has expired. Please sign in again to continue.",
          {
            [REAUTH_BUTTON_TEXT]: async () => await getCCloudAuthSession({ createIfNone: true }),
          },
        );
      } else if (previousState !== ConnectedState.NONE) {
        logger.debug(
          `CCloud connection transitioned from ${previousState} to ${ConnectedState.NONE}`,
        );
        ccloudAuthSessionInvalidated.fire();
      } else {
        logger.debug(`CCloud connection in initial ${ConnectedState.NONE} state (no tokens)`);
      }
      break;

    default:
      logger.warn(`handleUpdatedConnection: unhandled CCloud state ${connectedState}`);
  }

  const errors: AuthError[] | undefined = status.errors;
  // only show another notification if we haven't already handled the `Failed` state
  if (connectedState !== ConnectedState.FAILED && errors && errors.length > 0) {
    logger.debug("checking CCloud status errors", { errors });

    // With the internal connection manager, any errors that reach here are non-transient
    // since transient errors are handled internally with retries
    const errorMessages = errors.map((e) => e.message).join("; ");
    logger.warn("errors detected in CCloud connection", { errorMessages });

    ccloudAuthSessionInvalidated.fire();
    void showErrorNotificationWithButtons(
      "Error authenticating with Confluent Cloud. Please try again.",
      {
        [CCLOUD_SIGN_IN_BUTTON_LABEL]: async () =>
          await getCCloudAuthSession({ createIfNone: true }),
      },
    );
  }
}
