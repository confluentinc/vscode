import { Disposable } from "vscode";
import { CCLOUD_CONNECTION_ID, LOCAL_CONNECTION_ID } from "../constants";
import { ResourceLoader } from "../loaders/resourceLoader";
import { CCloudResourceLoader } from "./ccloudResourceLoader";
import { LocalResourceLoader } from "./localResourceLoader";

/** Construct and register the singleton resource loaders so they may register their event listeners and
 * so that ResourceLoader.getInstance() will find them. */
export function constructResourceLoaderSingletons(): Disposable[] {
  const ccloudLoader = CCloudResourceLoader.getInstance();
  ResourceLoader.registerInstance(CCLOUD_CONNECTION_ID, ccloudLoader);

  const localLoader = LocalResourceLoader.getInstance();
  ResourceLoader.registerInstance(LOCAL_CONNECTION_ID, localLoader);

  return [...ccloudLoader.disposables, ...localLoader.disposables];
}
