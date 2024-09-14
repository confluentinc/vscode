/** Thrown when attempting to get the ExtensionContext before extension activation. */
export class ExtensionContextNotSetError extends Error {
  constructor(source: string, message: string = "ExtensionContext not set yet") {
    super(`${source}: ${message}`);
  }
}
