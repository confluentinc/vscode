import * as vscode from "vscode";
import { AuthErrors, Connection, Status } from "../clients/sidecar";
import { CCLOUD_CONNECTION_ID } from "../constants";
import { observabilityContext } from "../context/observability";
import { ccloudAuthSessionInvalidated, nonInvalidTokenStatus } from "../emitters";
import { Logger } from "../logging";
import { getResourceManager } from "../storage/resourceManager";
import { getCCloudAuthSession } from "./utils";

const logger = new Logger("authn.ccloudStateHandling");

/*
 * Module-level constants regarding ccloud reauthentication and auth expiration warnings.
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

/** Singleton class to track the state of the various auth prompts that can be shown to the user. */
export class AuthPromptTracker {
  /** Keeps track of whether or not the user has been prompted to attempt logging in again after an
   * auth-related error status (not expiration-related). */
  public authErrorPromptOpen: boolean = false;
  /** Have we already shown a warning notification that the user's auth status is about to expire? */
  public reauthWarningPromptOpen: boolean = false;
  /** The earliest time we can show a reauth warning notification to the user */
  public earliestReauthWarning: Date = new Date(0);

  private static instance: AuthPromptTracker | null = null;
  private constructor() {}
  public static getInstance(): AuthPromptTracker {
    if (!AuthPromptTracker.instance) {
      AuthPromptTracker.instance = new AuthPromptTracker();
    }
    return AuthPromptTracker.instance;
  }
}

/**
 * React to the current CCloud connection's authentication state. Passes the connection through for
 * checking authentication expiration and errors.
 *
 * Called whenever sidecar pushes an update to the ccloud connection via websocket event to us.
 */
export async function reactToCCloudAuthState(connection: Connection): Promise<void> {
  logger.debug("received update to CCloud connection", {
    status: connection.status.authentication.status,
    expiration: connection.status.authentication.requires_authentication_at,
    errors: connection.status.authentication.errors,
  });

  const authStatus: Status = connection.status.authentication.status;
  observabilityContext.ccloudAuthLastSeenStatus = authStatus;

  await getResourceManager().setCCloudAuthStatus(authStatus);
  if (authStatus === "INVALID_TOKEN") {
    // Don't bother checking for expiration or errors until we get another status back
    return;
  } else {
    // ensure any open progress notifications are closed even if no requests are going through the middleware
    nonInvalidTokenStatus.fire();
  }

  // if the auth status is still valid, but it's within {MINUTES_UNTIL_REAUTH_WARNING}min of expiring,
  // warn the user to reauth; also handle if the session has already expired
  const sessionExpired: boolean = await checkAuthExpiration(connection);
  if (sessionExpired) {
    // don't bother looking for errors if the session has already expired, the result is going to be
    // the same: the user needs to reauthenticate
    return;
  }

  // if we get any kind of `.status.authentication.errors`, throw an error notification so the user
  // can try to reauthenticate
  checkAuthErrors(connection);
}

/**
 * Checks if the existing CCloud {@link Connection} auth session is expiring soon (or has already
 * expired) and prompts the user to reauthenticate if necessary.
 * If the auth session expired, we'll show an error notification to the user to reauthenticate.
 * If the auth session is about to expire, we'll show a warning notification to the user to reauthenticate soon.
 * @returns `true` if the auth session has already expired, `false` otherwise
 */
export async function checkAuthExpiration(connection: Connection): Promise<boolean> {
  const expiration: Date | undefined = connection.status.authentication.requires_authentication_at;
  const tracker = AuthPromptTracker.getInstance();
  if (!expiration) {
    // the user hasn't authenticated yet (or the auth status may be INVALID_TOKEN) and we may not
    // have an expiration date yet, so we can't check if it's about to expire
    tracker.reauthWarningPromptOpen = false;
    return false;
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
    tracker,
  };
  if (!authExpiresSoon) {
    // Reset our reauth warning prompt state so we can re-prompt if we fall into another
    // reauth warning window later
    tracker.reauthWarningPromptOpen = false;
    return false;
  }

  // If we haven't prompted the user to authenticate, earliestReauthWarning will be 0 / Jan 1 1970,
  // so it's safe to prompt the user. if they dismissed the prompt, we'll have set earliestReauthWarning
  // to {REAUTH_WARNING_DELAY_MINUTES}min after that point, so we need to check if we're past that
  // time to prompt them again. If the auth expired, we'll prompt them immediately.
  const canWarnAboutReauthentication = tracker.earliestReauthWarning.getTime() < Date.now();
  const authExpired = minutesUntilExpiration <= 0;
  if (!canWarnAboutReauthentication && !authExpired) {
    logger.debug(
      "user dismissed reauth warning, waiting until next check to prompt again",
      logBody,
    );
    return false;
  }

  // if we go this far, the user either hasn't been warned yet or they dismissed the warning and it's
  // time to re-prompt them
  const expirationString = expiration.toLocaleString();
  if (authExpired) {
    logger.error(
      "current CCloud connection expired, resetting CCloud connection and showing reauth error notification",
      logBody,
    );
    await handleExpiredAuth(expirationString);
    return true;
  } else {
    if (!tracker.reauthWarningPromptOpen) {
      logger.warn(
        "current CCloud connection is about to expire, showing reauth warning notification",
        logBody,
      );
      handleUpcomingAuthExpiration(signInUri, expirationString, minutesUntilExpiration);
    }
  }
  return false;
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
  const tracker = AuthPromptTracker.getInstance();
  tracker.reauthWarningPromptOpen = true;
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
        tracker.earliestReauthWarning = new Date(Date.now() + REAUTH_BUFFER_MINUTES * 60 * 1000);
        // reauthWarningPromptOpen is reset to `false` once we get an updated status back
      } else if (response === REMIND_BUTTON_TEXT) {
        // update the last time we prompted the user to reauthenticate to be 15min in the future
        // so we don't spam them with warnings
        tracker.earliestReauthWarning = new Date(
          Date.now() + REAUTH_WARNING_DELAY_MINUTES * 60 * 1000,
        );
        tracker.reauthWarningPromptOpen = false;
      } else {
        // if the user dismisses the warning, we'll almost immediately prompt them again since we
        // aren't adjusting the earliestReauthWarning time
        tracker.reauthWarningPromptOpen = false;
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
async function handleExpiredAuth(expirationString: string) {
  // inform the auth provider that the session has expired (which will also delete the CCloud
  // connection via the sidecar and clear out sidebar resources)
  ccloudAuthSessionInvalidated.fire();

  vscode.window
    .showErrorMessage(
      `Confluent Cloud authentication expired at ${expirationString}.`,
      REAUTH_BUTTON_TEXT,
    )
    .then(async (response) => {
      if (response === REAUTH_BUTTON_TEXT) {
        // go through the auth provider's `createSession()` instead of trying to create a new CCloud
        // connection via the sidecar and hooking it back up to the auth provider state. this will
        // create the new CCloud connection and trigger the browser-based login with new sign-in URI
        await getCCloudAuthSession(true);
      }
    });
}

/** Check the {@link Connection} for any auth-related errors and prompt the user to reauthenticate. */
export function checkAuthErrors(connection: Connection) {
  const errors: AuthErrors | undefined = connection.status.authentication.errors;
  if (!errors) {
    return;
  }

  // tell the auth provider that the session is invalid so it can prompt the user to log in again
  // and clear out the sidebar resources (but not delete the connection)
  ccloudAuthSessionInvalidated.fire();

  const tracker = AuthPromptTracker.getInstance();
  logger.error("errors returned while checking auth status", {
    connectionId: connection.spec.id,
    errors,
    promptingUser: !tracker.authErrorPromptOpen,
  });

  if (tracker.authErrorPromptOpen) {
    // if we've already prompted the user to reauthenticate, don't do it again unless they dismiss
    // it and we continue to see errors
    return;
  }

  let authButton: string = "Log in to Confluent Cloud";
  // show an error message to the user to retry the auth flow
  tracker.authErrorPromptOpen = true;
  vscode.window
    .showErrorMessage("Error authenticating with Confluent Cloud. Please try again.", authButton)
    .then(async (response: string | undefined) => {
      // always reset the prompt tracker after the user interacts with the notification in any way,
      // since they will either dismiss it (and we re-prompt at the next iteration) or they re-
      // authenticate and we get a new status back (or another auth error at the next iteration)
      tracker.authErrorPromptOpen = false;
      if (response === authButton) {
        // if we got to this point, we likely cleared out the existing connection via the
        // `ccloudAuthSessionInvalidated` emitter, so we need to create a new session to re-auth
        await getCCloudAuthSession(true);
      }
    });
}

export function openExternal(uri: vscode.Uri) {
  if (process.env.NODE_ENV === "testing") {
    // XXX never remove this log, tests rely on it
    logger.info("actionOpenExternal", uri.toString());
    return Promise.resolve(true);
  }
  return vscode.env.openExternal(uri);
}
