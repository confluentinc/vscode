import { CCloudStatus, ConnectedState, Connection } from "../clients/sidecar";
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
 * Checks mainly for two things based on the {@link ConnectedState}:
 * - expiration of the CCloud authentication, which will trigger a reauthentication flow
 * - any errors that may have occurred during the authentication process, which will also trigger
 *   a reauthentication flow
 * Additionally, any non-`ATTEMPTING` state will close any open progress notifications
 * that may have been opened by the middleware.
 */
export async function handleUpdatedConnection(connection: Connection): Promise<void> {
  const status: CCloudStatus | undefined = connection.status.ccloud;
  if (!status) {
    logger.warn("no CCloud status found in connection, skipping auth state handling");
    return;
  }

  const connectedState: ConnectedState = status.state;
  logger.debug("received update to CCloud connection", {
    state: connectedState,
    expiration: status.requires_authentication_at,
    errors: status.errors,
  });

  observabilityContext.ccloudAuthLastSeenState = connectedState;
  await getResourceManager().setCCloudState(connectedState);

  if (connectedState !== ConnectedState.Attempting) {
    // ensure any open progress notifications are closed even if no requests are going through the middleware
    stableCCloudConnectedState.fire();
  }

  if ([ConnectedState.Success, ConnectedState.Attempting].includes(connectedState)) {
    // no action needed here
    return;
  }

  ccloudAuthSessionInvalidated.fire();

  if (connectedState === ConnectedState.Expired) {
    // go through the auth provider's `createSession()` instead of trying to create a new CCloud
    // connection via the sidecar and hooking it back up to the auth provider state. this will
    // create the new CCloud connection and trigger the browser-based login with new sign-in URI
    void showInfoNotificationWithButtons(`Confluent Cloud authentication expired.`, {
      [REAUTH_BUTTON_TEXT]: async () => await getCCloudAuthSession(true),
    });
  }

  // also check for any errors, whether we see EXPIRED, FAILED, or NONE
  if (status.errors && Object.keys(status.errors).length > 0) {
    void showErrorNotificationWithButtons(
      "Error authenticating with Confluent Cloud. Please try again.",
      { [CCLOUD_SIGN_IN_BUTTON_LABEL]: async () => await getCCloudAuthSession(true) },
    );
  }
}
