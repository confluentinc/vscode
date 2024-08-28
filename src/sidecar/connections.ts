import * as vscode from "vscode";
import { getSidecar } from ".";
import { getAuthSession } from "../authProvider";
import { AuthErrors, Connection, ConnectionsResourceApi, ResponseError } from "../clients/sidecar";
import { CCLOUD_CONNECTION_ID, CCLOUD_CONNECTION_SPEC } from "../constants";
import {
  currentCCloudEnvironmentChanged,
  currentKafkaClusterChanged,
  currentSchemaRegistryChanged,
} from "../emitters";
import { Logger } from "../logging";
import { getResourceManager } from "../storage/resourceManager";
import { IntervalPoller } from "../utils/timing";

const logger = new Logger("sidecarManager.connections");

/*
 * Module-level constants regarding reauthentication and auth expiration warnings.
 * (Maybe also collect into singleton class for organization and data hiding?)
 */
/** How long before auth expiration we can show a warning notification to the user */
export const MINUTES_UNTIL_REAUTH_WARNING = 60;
/**  How long to delay notifications if a user clicks "Reauthenticate" before we prompt them again
 *   if we somehow still have an upcoming auth expiration */
const REAUTH_BUFFER_MINUTES = 5;
/** How long to delay notifications if a user clicks "Remind Me Later" on the reauth warning */
// TODO: make this configurable?
const REAUTH_WARNING_DELAY_MINUTES = 15;

// labels for the buttons exposed by the notifications
export const REAUTH_BUTTON_TEXT = "Reauthenticate";
export const REMIND_BUTTON_TEXT = "Remind Me Later";

/**
 * Singleton class to track the state of the various auth prompts that can be shown to the user.
 */
class AuthPromptTracker {
  private static instance: AuthPromptTracker;
  /** Keeps track of whether or not the user has been prompted to attempt logging in again after an
   * auth-related error status (not expiration-related). */
  public authErrorPromptOpen: boolean = false;
  /** Have we already shown a warning notification that the user's auth status is about to expire? */
  public reauthWarningPromptOpen: boolean = false;
  /** Have we already shown an error notification that the user's auth status has expired? */
  public authExpiredPromptOpen: boolean = false;
  /** The earliest time we can show a reauth warning notification to the user */
  public earliestReauthWarning: Date = new Date(0);

  private constructor() {}

  public static getInstance(): AuthPromptTracker {
    if (!AuthPromptTracker.instance) {
      AuthPromptTracker.instance = new AuthPromptTracker();
    }
    return AuthPromptTracker.instance;
  }
}
export const AUTH_PROMPT_TRACKER = AuthPromptTracker.getInstance();

/**
 * Create a new Confluent Cloud connection in the sidecar and return the connection object.
 */
export async function createCCloudConnection(): Promise<Connection> {
  // create the initial Connection object, which will be kept in sidecar memory as well as
  // in the extension's global state
  let connection: Connection;
  const client: ConnectionsResourceApi = (await getSidecar()).getConnectionsResourceApi();
  try {
    connection = await client.gatewayV1ConnectionsPost({
      ConnectionSpec: CCLOUD_CONNECTION_SPEC,
    });
    logger.info("created new connection", connection);
    return connection;
  } catch (error) {
    logger.error("create connection error", error);
    throw new Error("Error while trying to create new connection. Please try again.");
  }
}

export async function watchCCloudConnectionStatus(): Promise<void> {
  const session: vscode.AuthenticationSession | undefined = await getAuthSession();
  if (!session) {
    // not logged in according to auth provider
    return;
  }

  const connection: Connection | null = await getCCloudConnection();
  if (!connection) {
    logger.warn("no connection found for current auth session");
    return;
  }

  // if we get any kind of `.status.authentication.errors`, throw an error notification so the user
  // can try to reauthenticate
  checkAuthErrors(connection);

  // if the auth status is still valid, but it's within {MINUTES_UNTIL_REAUTH_WARNING}min of expiring,
  // warn the user to reauth
  checkAuthExpiration(connection);
}

/** Poller to ensure the current connection, if any, is in a
 * a good state.
 */
export const pollCCloudConnectionAuth = new IntervalPoller(
  "pollCCloudConnectionAuth",
  watchCCloudConnectionStatus,
);

export function checkAuthExpiration(connection: Connection) {
  const expiration: Date | undefined = connection.status.authentication.requires_authentication_at;
  if (!expiration) {
    // the user hasn't authenticated yet (or the auth status may be INVALID_TOKEN) and we may not
    // have an expiration date yet, so we can't check if it's about to expire
    AUTH_PROMPT_TRACKER.reauthWarningPromptOpen = false;
    AUTH_PROMPT_TRACKER.authExpiredPromptOpen = false;
    return;
  }

  const signInUri = connection.metadata.sign_in_uri!;

  // the user has authenticated, so we can check if their session is about to expire:
  // if the authExpiration is less than 60min from now, we should prompt the user to reauthenticate
  const minutesUntilExpiration = Math.round((expiration.getTime() - Date.now()) / 1000 / 60);
  const authExpiresSoon = minutesUntilExpiration < MINUTES_UNTIL_REAUTH_WARNING;
  const logBody = {
    connectionId: CCLOUD_CONNECTION_ID,
    authStatus: connection.status.authentication.status,
    expiration,
    minutesUntilExpiration,
    authExpiresSoon,
    AUTH_PROMPT_TRACKER,
  };
  if (!authExpiresSoon) {
    // Reset our reauth warning prompt state so we can re-prompt if we fall into another
    // reauth warning window later
    AUTH_PROMPT_TRACKER.reauthWarningPromptOpen = false;
    AUTH_PROMPT_TRACKER.authExpiredPromptOpen = false;
    return;
  }

  // if we haven't prompted the user to authenticate, earliestReauthWarning will be 0 / Jan 1 1970,
  // so it's safe to prompt the user. if they dismissed the prompt, we'll have set earliestReauthWarning
  // to {REAUTH_WARNING_DELAY_MINUTES}min after that point, so we need to check if we're past that
  // time to prompt them again
  const canWarnAboutReauthentication =
    AUTH_PROMPT_TRACKER.earliestReauthWarning.getTime() < Date.now();
  if (!canWarnAboutReauthentication) {
    logger.debug(
      "user dismissed reauth warning, waiting until next check to prompt again",
      logBody,
    );
    return;
  }

  // if we go this far, the user either hasn't been warned yet or they dismissed the warning and it's
  // time to re-prompt them
  const expirationString = expiration.toLocaleString();
  if (minutesUntilExpiration <= 0) {
    if (!AUTH_PROMPT_TRACKER.authExpiredPromptOpen) {
      logger.error("current CCloud connection expired, showing reauth error notification", logBody);
      handleExpiredAuth(signInUri, expirationString);
    }
  } else {
    if (!AUTH_PROMPT_TRACKER.reauthWarningPromptOpen) {
      logger.warn(
        "current CCloud connection is about to expire, showing reauth warning notification",
        logBody,
      );
      handleUpcomingAuthExpiration(signInUri, expirationString, minutesUntilExpiration);
    }
  }
}

/**
 * Handle the case where the user's Confluent Cloud authentication is about to expire and they haven't
 * delayed previous "auth expiring soon" warning notifications.
 * @param signInUri The URL to open in the user's browser to reauthenticate
 * @param expirationString The date and time when the user's authentication will expire
 * @param minutesUntilExpiration The number of minutes until the user's authentication expires
 */
function handleUpcomingAuthExpiration(
  signInUri: string,
  expirationString: string,
  minutesUntilExpiration: number,
) {
  // set this to prevent the user from being spammed with reauth warnings
  AUTH_PROMPT_TRACKER.reauthWarningPromptOpen = true;
  vscode.window
    .showWarningMessage(
      `Confluent Cloud authentication will expire in ${minutesUntilExpiration} minutes (${expirationString}).`,
      REAUTH_BUTTON_TEXT,
      REMIND_BUTTON_TEXT,
    )
    .then((response) => {
      if (response === REAUTH_BUTTON_TEXT) {
        // allow ~5min buffer after the user opens the link to reauthenticate before we prompt again
        openExternal(vscode.Uri.parse(signInUri));
        AUTH_PROMPT_TRACKER.earliestReauthWarning = new Date(
          Date.now() + REAUTH_BUFFER_MINUTES * 60 * 1000,
        );
        // reauthWarningPromptOpen is reset to `false` once we get an updated status back
      } else if (response === REMIND_BUTTON_TEXT) {
        // update the last time we prompted the user to reauthenticate to be 15min in the future
        // so we don't spam them with warnings
        AUTH_PROMPT_TRACKER.earliestReauthWarning = new Date(
          Date.now() + REAUTH_WARNING_DELAY_MINUTES * 60 * 1000,
        );
        AUTH_PROMPT_TRACKER.reauthWarningPromptOpen = false;
      } else {
        // if the user dismisses the warning, we'll almost immediately prompt them again since we
        // aren't adjusting the earliestReauthWarning time
        AUTH_PROMPT_TRACKER.reauthWarningPromptOpen = false;
      }
    });
}

/**
 * Handle the case where the user's Confluent Cloud authentication has expired and they haven't
 * dismissed a previous "auth expired" notification.
 * @remarks If the expiration is in the past, we should have already prompted the user to reauthenticate
  (at least once), and they should have either reauthenticated or dismissed the prompt, OR they
  ignored it entirely. Throw up one final (error) notification to the user to reauthenticate
  before the errors start piling up.
 * @param signInUri The URL to open in the user's browser to reauthenticate
 * @param expirationString The date and time when the user's authentication will expire
 */
function handleExpiredAuth(signInUri: string, expirationString: string) {
  // set this to prevent the user from being spammed with reauth warnings
  AUTH_PROMPT_TRACKER.authExpiredPromptOpen = true;
  vscode.window
    .showErrorMessage(
      `Confluent Cloud authentication expired at ${expirationString}.`,
      REAUTH_BUTTON_TEXT,
    )
    .then((response) => {
      if (response === REAUTH_BUTTON_TEXT) {
        // allow ~5min buffer after the user opens the link to reauthenticate before we prompt again
        openExternal(vscode.Uri.parse(signInUri));
        AUTH_PROMPT_TRACKER.earliestReauthWarning = new Date(
          Date.now() + REAUTH_BUFFER_MINUTES * 60 * 1000,
        );
        // `authExpiredPromptOpen` is reset to `false` once we get an updated status back
      } else {
        // if they dismiss altogether, there isn't much we can do until they decide to re-auth, so
        // we leave `authExpiredPromptOpen` set to `true` and don't prompt them again
      }
    });
}

export function checkAuthErrors(connection: Connection) {
  const errors: AuthErrors | undefined = connection.status.authentication.errors;
  if (!errors) {
    return;
  }

  logger.error("errors returned during auth flow", {
    connectionId: connection.spec.id,
    errors,
    promptingUser: !AUTH_PROMPT_TRACKER.authErrorPromptOpen,
  });

  if (AUTH_PROMPT_TRACKER.authErrorPromptOpen) {
    // if we've already prompted the user to reauthenticate, don't do it again unless they dismiss
    // it and we continue to see errors
    return;
  }

  let authButton: string = "Log in to Confluent Cloud";
  // show an error message to the user to retry the auth flow
  AUTH_PROMPT_TRACKER.authErrorPromptOpen = true;
  vscode.window
    .showErrorMessage("Error authenticating with Confluent Cloud. Please try again.", authButton)
    .then((response: string | undefined) => {
      // always reset the prompt tracker after the user interacts with the notification in any way,
      // since they will either dismiss it (and we re-prompt at the next iteration) or they re-
      // authenticate and we get a new status back (or another auth error at the next iteration)
      AUTH_PROMPT_TRACKER.authErrorPromptOpen = false;
      if (response === authButton) {
        openExternal(vscode.Uri.parse(connection.metadata.sign_in_uri!));
      }
    });
}

export async function clearCurrentCCloudResources() {
  // if the current connection changes or is deleted, we need to unset any associated CCloud resources
  // that may have depended on it:
  // - delete the extension state references to make sure they can't be used
  // - fire events to update things like the Topics view, Schemas view, etc.
  const resourceManager = getResourceManager();
  logger.warn("clearing current CCloud resources from extension state");
  await Promise.all([
    resourceManager.deleteCCloudEnvironments(),
    resourceManager.deleteCCloudKafkaClusters(),
    resourceManager.deleteCCloudSchemaRegistryClusters(),
  ]);
  currentCCloudEnvironmentChanged.fire(null);
  currentKafkaClusterChanged.fire(null);
  currentSchemaRegistryChanged.fire(null);
}

export function openExternal(uri: vscode.Uri) {
  if (process.env.NODE_ENV === "testing") {
    // XXX never remove this log, tests rely on it
    logger.info("actionOpenExternal", uri.toString());
    return Promise.resolve(true);
  }
  return vscode.env.openExternal(uri);
}

/** Convenience function to get the CCloud {@link Connection} from the sidecar, if it exists. */
export async function getCCloudConnection(): Promise<Connection | null> {
  let connection: Connection | null = null;
  const client = (await getSidecar()).getConnectionsResourceApi();
  try {
    connection = await client.gatewayV1ConnectionsIdGet({ id: CCLOUD_CONNECTION_ID });
  } catch (e) {
    if (!(e instanceof ResponseError && e.response.status === 404)) {
      // only log the non-404 errors, since we expect a 404 if the connection doesn't exist
      logger.error("Error getting existing connection", e);
    }
  }
  return connection;
}
