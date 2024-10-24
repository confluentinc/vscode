import * as vscode from "vscode";
import { AuthErrors, Connection } from "../clients/sidecar";
import { CCLOUD_CONNECTION_ID } from "../constants";
import { ccloudAuthSessionInvalidated } from "../emitters";
import { Logger } from "../logging";
import { IntervalPoller } from "../utils/timing";
import { getCCloudAuthSession, getCCloudConnection } from "./connections";

const logger = new Logger("sidecar.authStatusPolling");

// TODO(shoup): the majority of this auth checking/prompting logic below should move into the auth provider

/*
 * Module-level constants regarding reauthentication and auth expiration warnings.
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
class AuthPromptTracker {
  private static instance: AuthPromptTracker;
  /** Keeps track of whether or not the user has been prompted to attempt logging in again after an
   * auth-related error status (not expiration-related). */
  public authErrorPromptOpen: boolean = false;
  /** Have we already shown a warning notification that the user's auth status is about to expire? */
  public reauthWarningPromptOpen: boolean = false;
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

/** Used to prevent multiple instances of the `INVALID_TOKEN` progress notification stacking up. */
let invalidTokenNotificationOpen: boolean = false;
/** Fires whenever we see a non-`INVALID_TOKEN` authentication status from the sidecar for the
 * current CCloud connection, and is only used to resolve an open progress notification. */
let nonInvalidTokenStatus: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();

/**
 * Poller to call {@link watchCCloudConnectionStatus} every 10 seconds to check the auth status of
 * the current CCloud connection.
 *
 * Starting and stopping is handled by the `ConfluentCloudAuthProvider` based on changes to the
 * authentication session state.
 */
export const pollCCloudConnectionAuth = new IntervalPoller(
  "pollCCloudConnectionAuth",
  watchCCloudConnectionStatus,
);

/** Checks the current CCloud connection's authentication status passes the connection through for
 * checking authentication expiration and errors. */
export async function watchCCloudConnectionStatus(): Promise<void> {
  const connection: Connection | null = await getCCloudConnection();
  if (!connection) {
    logger.warn("no connection found for current auth session");
    return;
  }

  logger.debug("checking auth status for CCloud connection", {
    status: connection.status.authentication.status,
    expiration: connection.status.authentication.requires_authentication_at,
    errors: connection.status.authentication.errors,
  });

  if (connection.status.authentication.status !== "INVALID_TOKEN") {
    // resolve any open progress notification if we see a non-`INVALID_TOKEN` status
    nonInvalidTokenStatus.fire();
    // and go back to polling every 10sec
    pollCCloudConnectionAuth.useSlowFrequency();
  }

  if (["NO_TOKEN", "FAILED"].includes(connection.status.authentication.status)) {
    // some unusable state that requires the user to reauthenticate
    logger.error(
      "current CCloud connection has no token or transitioned to a failed state; invalidating auth session",
      {
        status: connection.status.authentication.status,
      },
    );
    ccloudAuthSessionInvalidated.fire();
  } else if (connection.status.authentication.status === "INVALID_TOKEN") {
    // the sidecar is handling a transient error, so exit this polling iteration early and check
    // the status again on the next iteration
    logger.warn("current CCloud connection has an invalid token; waiting for updated status");
    if (!invalidTokenNotificationOpen) {
      invalidTokenNotificationOpen = true;
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Attempting to reconnect to Confluent Cloud...",
          cancellable: false,
        },
        async () => {
          await new Promise((resolve) => {
            nonInvalidTokenStatus.event(resolve);
          });
        },
      );
    }
    // poll faster to try and resolve the connection status so the notification doesn't need to stay
    // open for the full 10sec until the next check
    pollCCloudConnectionAuth.useFastFrequency();
    return;
  }

  // if we get any kind of `.status.authentication.errors`, throw an error notification so the user
  // can try to reauthenticate
  checkAuthErrors(connection);

  // if the auth status is still valid, but it's within {MINUTES_UNTIL_REAUTH_WARNING}min of expiring,
  // warn the user to reauth
  await checkAuthExpiration(connection);
}

/**
 * Checks if the existing CCloud {@link Connection} auth status is expiring soon (or has already
 * expired) and prompts the user to reauthenticate if necessary.
 */
export async function checkAuthExpiration(connection: Connection) {
  const expiration: Date | undefined = connection.status.authentication.requires_authentication_at;
  if (!expiration) {
    // the user hasn't authenticated yet (or the auth status may be INVALID_TOKEN) and we may not
    // have an expiration date yet, so we can't check if it's about to expire
    AUTH_PROMPT_TRACKER.reauthWarningPromptOpen = false;
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
    return;
  }

  // If we haven't prompted the user to authenticate, earliestReauthWarning will be 0 / Jan 1 1970,
  // so it's safe to prompt the user. if they dismissed the prompt, we'll have set earliestReauthWarning
  // to {REAUTH_WARNING_DELAY_MINUTES}min after that point, so we need to check if we're past that
  // time to prompt them again. If the auth expired, we'll prompt them immediately.
  const canWarnAboutReauthentication =
    AUTH_PROMPT_TRACKER.earliestReauthWarning.getTime() < Date.now();
  const authExpired = minutesUntilExpiration <= 0;
  if (!canWarnAboutReauthentication && !authExpired) {
    logger.debug(
      "user dismissed reauth warning, waiting until next check to prompt again",
      logBody,
    );
    return;
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

/**
 * Check the {@link Connection} for any auth-related errors and prompt the user to reauthenticate if
 * necessary.
 */
export function checkAuthErrors(connection: Connection) {
  const errors: AuthErrors | undefined = connection.status.authentication.errors;
  if (!errors) {
    return;
  }

  logger.error("errors returned while checking auth status", {
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
    .then(async (response: string | undefined) => {
      // always reset the prompt tracker after the user interacts with the notification in any way,
      // since they will either dismiss it (and we re-prompt at the next iteration) or they re-
      // authenticate and we get a new status back (or another auth error at the next iteration)
      AUTH_PROMPT_TRACKER.authErrorPromptOpen = false;
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
