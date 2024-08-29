/**
 * Indicate the outcome of the last CCloud authentication attempt.
 * Used by the `ConfluentCloudAuthProvider` to resolve promises that are waiting for the user's
 * browser-based authentication flow to complete after handling a URI callback from the sidecar.
 */
export const AUTH_COMPLETED_KEY = "authCompleted";
