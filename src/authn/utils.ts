import type { AuthenticationGetSessionOptions, AuthenticationSession } from "vscode";
import { authentication } from "vscode";
import { AUTH_PROVIDER_ID } from "../constants";

/**
 * Convenience function to check with the authentication API and get a CCloud auth session, if
 * one exists.
 *
 * NOTE: Use this to check for CCloud authentication status. Any change in CCloud connection status
 * will be fired through the `ccloudConnected` event emitter.
 *
 * @param options Optional {@link AuthenticationGetSessionOptions}. If not provided, defaults to
 * {@linkcode AuthenticationGetSessionOptions.createIfNone createIfNone}:`false`.
 */
export async function getCCloudAuthSession(
  options?: AuthenticationGetSessionOptions,
): Promise<AuthenticationSession | undefined> {
  return await authentication.getSession(AUTH_PROVIDER_ID, [], options ?? { createIfNone: false });
}
