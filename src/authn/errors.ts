/**
 * Error representing a handled unhappy path during the Confluent Cloud sign-in flow through the
 * authentication provider.
 */
export class CCloudSignInError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CCloudSignInError";
  }
}
