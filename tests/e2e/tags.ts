/** {@see https://playwright.dev/docs/test-annotations#tag-tests} */
export enum Tag {
  Smoke = "@smoke",

  /** Tests that require a CCloud connection to be set up and authenticated */
  CCloud = "@ccloud",
  /** Tests that require a direct connection to be set up */
  Direct = "@direct",
  /** Tests that require a local connection to be set up */
  Local = "@local",
}
