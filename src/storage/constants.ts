// SECRET STORAGE KEYS
// NOTE: these aren't actually storing any secrets, just used for cross-workspace event handling

/**
 * Indicate the outcome of the last CCloud authentication attempt.
 * Used by the `ConfluentCloudAuthProvider` to resolve promises that are waiting for the user's
 * browser-based authentication flow to complete after handling a URI callback from the sidecar.
 */
export const AUTH_COMPLETED_KEY = "authCompleted";
/** Only used as a way to kick off cross-workspace events foir the authentication provider. Only\
 * ever set to "true" or deleted. */
export const AUTH_SESSION_EXISTS_KEY = "authSessionExists";
