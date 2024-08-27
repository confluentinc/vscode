declare module "ide-sidecar" {
  /** Path to ide-sidecar binary file. The version is resolved at build time. */
  const path: string;
  /** The ide-sidecar version is resolved at build time. */
  export const version: string;
  export default path;
}
