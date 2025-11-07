/**
 * Error representing a handled unhappy path during the Confluent Cloud sign-in flow through the
 * authentication provider or when converting an existing connection to a VS Code AuthenticationSession.
 */
export class CCloudConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CCloudConnectionError";
  }
}
