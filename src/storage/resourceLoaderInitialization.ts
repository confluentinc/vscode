import { Disposable } from "vscode";
import { CCLOUD_CONNECTION_ID, LOCAL_CONNECTION_ID } from "../constants";
import { CCloudResourceLoader } from "./ccloudResourceLoader";
import { LocalResourceLoader } from "./localResourceLoader";
import { ResourceLoader } from "./resourceLoader";

/* This is used by both extension initialization and also the global test suite setup.

   (Alas, cannot import + use this when defined within extension.ts, because
    of issues with other imports within extension.ts (
     extension.ts -> consume.ts -> inertial.js:
       Error [ERR_REQUIRE_ESM]: require() of ES Module /Users/jlrobins/git/vscode/node_modules/inertial/inertial.js from /Users/jlrobins/git/vscode/out/src/consume.js not supported.
       Instead change the require of inertial.js in /Users/jlrobins/git/vscode/out/src/consume.js to a dynamic import() which is available in all CommonJS modules.
     )
    So it lives in this separate file, but above both ResourceLoader and the implementations in the import hierarchy.
*/

/** Construct the singleton resource loaders so they may register their event listeners. */
export function constructResourceLoaderSingletons(): Disposable[] {
  ResourceLoader.registerInstance(CCLOUD_CONNECTION_ID, CCloudResourceLoader.getInstance());
  ResourceLoader.registerInstance(LOCAL_CONNECTION_ID, LocalResourceLoader.getInstance());

  return ResourceLoader.getDisposables();
}
