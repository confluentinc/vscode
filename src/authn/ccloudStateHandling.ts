import {
  AuthError,
  AuthErrors,
  CCloudStatus,
  ConnectedState,
  Connection,
} from "../clients/sidecar";
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
 * Checks mainly for different {@link ConnectedState} values and `errors` data:
 * - `NONE`: User hasn't authenticated yet, all three tokens are not yet available, or session
 *      has expired (8-hour lifetime reached)
 * - `SUCCESS`: Fully authenticated and operational
 * - `EXPIRED`: Tokens exist but API calls are failing (temporary issue)
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
  const previousState: ConnectedState = await resourceManager.getCCloudState();

  logger.debug("received update to CCloud connection", {
    currentState: connectedState,
    previousState,
    expiration: status.requires_authentication_at,
    errors: status.errors,
  });

  // only update state tracking if it changed from the last event
  if (connectedState !== previousState) {
    observabilityContext.ccloudAuthLastSeenState = connectedState;
    await resourceManager.setCCloudState(connectedState);
    logger.debug(`CCloud connected state transition: ${previousState} -> ${connectedState}`);
  }

  if (connectedState !== ConnectedState.Attempting) {
    // ensure any open progress notifications are closed even if no requests are going through the middleware
    stableCCloudConnectedState.fire();
  }

  switch (connectedState) {
    case ConnectedState.Success:
    case ConnectedState.Attempting:
      // no action needed, just move on to checking for errors
      break;

    case ConnectedState.Expired:
      // tokens exist but API calls are failing
      logger.debug("CCloud tokens are expired; sidecar will attempt automatic token refresh");
      break;

    case ConnectedState.Failed:
      // non-transient error that requires user intervention
      logger.warn("CCloud connection failed with non-transient error");
      ccloudAuthSessionInvalidated.fire();
      void showErrorNotificationWithButtons(
        "Error authenticating with Confluent Cloud. Please try again.",
        {
          [CCLOUD_SIGN_IN_BUTTON_LABEL]: async () => await getCCloudAuthSession(true),
        },
      );
      break;

    case ConnectedState.None:
      ccloudAuthSessionInvalidated.fire();
      // try to detect session expiration via transition from SUCCESS/EXPIRED to NONE
      // see https://github.com/confluentinc/ide-sidecar/blob/121dc766ab64bea1d88212f34f0084eb692ade4d/src/main/java/io/confluent/idesidecar/restapi/connections/CCloudConnectionState.java#L116-L122
      if (previousState === ConnectedState.Success || previousState === ConnectedState.Expired) {
        logger.debug("CCloud session expired, prompting for reauthentication");
        void showInfoNotificationWithButtons(
          "Your Confluent Cloud session has expired. Please sign in again to continue.",
          {
            [REAUTH_BUTTON_TEXT]: async () => await getCCloudAuthSession(true),
          },
        );
      } else if (previousState !== ConnectedState.None) {
        logger.debug(
          `CCloud connection transitioned from ${previousState} to ${ConnectedState.None}`,
        );
      } else {
        logger.debug(`CCloud connection in initial ${ConnectedState.None} state (no tokens)`);
      }
      break;

    default:
      logger.warn(`handleUpdatedConnection: unhandled CCloud state ${connectedState}`);
  }

  const errors: AuthErrors | undefined = status.errors;
  if (errors && Object.keys(errors).length > 0) {
    logger.debug("checking CCloud status errors", { errors });

    // parse AuthErrors to see if we have any transient (or non-transient) errors
    const isTransientValues: boolean[] = [];
    Object.values(errors).forEach((error: AuthError) => {
      const isTransient: boolean | undefined = error.is_transient;
      if (isTransient !== undefined) {
        isTransientValues.push(isTransient);
      }
    });
    const hasTransientErrors: boolean = isTransientValues.some((val) => val === true);
    const hasNonTransientErrors: boolean = isTransientValues.some((val) => val === false);

    if (hasNonTransientErrors) {
      logger.warn("non-transient errors detected, requiring user intervention", {
        authStatusError: errors.auth_status_check?.message,
        signInError: errors.sign_in?.message,
        tokenRefreshError: errors.token_refresh?.message,
      });

      ccloudAuthSessionInvalidated.fire();
      void showErrorNotificationWithButtons(
        "Error authenticating with Confluent Cloud. Please try again.",
        {
          [CCLOUD_SIGN_IN_BUTTON_LABEL]: async () => await getCCloudAuthSession(true),
        },
      );
    } else if (hasTransientErrors) {
      logger.debug("transient errors detected, sidecar will retry automatically", {
        authStatusError: errors.auth_status_check?.message,
        signInError: errors.sign_in?.message,
        tokenRefreshError: errors.token_refresh?.message,
      });
    }
  }
}
