import { env, Uri } from "vscode";
import { Authentication, AuthError, AuthErrors, Connection, Status } from "../clients/sidecar";
import { observabilityContext } from "../context/observability";
import { ccloudAuthSessionInvalidated, nonInvalidTokenStatus } from "../emitters";
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
  const status: Authentication | undefined = connection.status.authentication;
  if (!status) {
    logger.warn("no CCloud status found in connection, skipping connected state handling");
    return;
  }

  const connectedState: Status = status.status;
  // check previously stored state for comparison later
  const resourceManager = getResourceManager();
  const previousState: string | undefined = await resourceManager.getCCloudAuthStatus();

  logger.debug("received update to CCloud connection", {
    currentState: connectedState,
    previousState,
    expiration: status.requires_authentication_at,
    errors: status.errors,
  });

  // only update state tracking if it changed from the last event
  if (connectedState !== previousState) {
    observabilityContext.ccloudAuthLastSeenStatus = connectedState;
    await resourceManager.setCCloudAuthStatus(connectedState);
    logger.debug(`CCloud connected state transition: ${previousState} -> ${connectedState}`);
  }

  if (connectedState !== Status.InvalidToken) {
    // ensure any open progress notifications are closed even if no requests are going through the middleware
    nonInvalidTokenStatus.fire();
  }

  switch (connectedState) {
    case Status.ValidToken:
    case Status.InvalidToken:
      // no action needed, just move on to checking for errors
      break;

    case Status.Failed:
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

    case Status.NoToken:
      // ccloudAuthSessionInvalidated.fire();

      // try to detect session expiration via transition from SUCCESS/EXPIRED to NONE
      // see https://github.com/confluentinc/ide-sidecar/blob/121dc766ab64bea1d88212f34f0084eb692ade4d/src/main/java/io/confluent/idesidecar/restapi/connections/CCloudConnectionState.java#L116-L122
      if (previousState === Status.ValidToken || previousState === Status.InvalidToken) {
        logger.debug("CCloud session expired, prompting for reauthentication");
        void showInfoNotificationWithButtons(
          "Your Confluent Cloud session has expired. Please sign in again to continue.",
          {
            [REAUTH_BUTTON_TEXT]: async () => await getCCloudAuthSession(true),
          },
        );
      } else if (previousState !== Status.NoToken) {
        logger.debug(`CCloud connection transitioned from ${previousState} to ${Status.NoToken}`);
      } else {
        logger.debug(`CCloud connection in initial ${Status.NoToken} state (no tokens)`);
      }
      break;

    default:
      logger.warn(`handleUpdatedConnection: unhandled CCloud state ${connectedState}`);
  }

  const errors: AuthErrors | undefined = status.errors;
  // only show another notification if we haven't already handled the `Failed` state
  if (connectedState !== Status.Failed && errors && Object.keys(errors).length > 0) {
    logger.debug("checking CCloud status errors", { errors });

    // parse AuthErrors to see if we have any transient (or non-transient) errors
    const isTransientValues: boolean[] = [];
    Object.values(errors).forEach((error: AuthError | undefined) => {
      if (!error) return;
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

export function openExternal(uri: Uri) {
  if (process.env.NODE_ENV === "testing") {
    // XXX never remove this log, tests rely on it
    logger.info("actionOpenExternal", uri.toString());
    return Promise.resolve(true);
  }
  return env.openExternal(uri);
}
