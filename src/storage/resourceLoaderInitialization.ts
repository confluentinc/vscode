import { Disposable } from "vscode";
import { CCLOUD_CONNECTION_ID, LOCAL_CONNECTION_ID } from "../constants";
import { CCloudResourceLoader } from "./ccloudResourceLoader";
import { LocalResourceLoader } from "./localResourceLoader";
import { ResourceLoader } from "./resourceLoader";

/** Construct and register the singleton resource loaders so they may register their event listeners and
 * so that ResourceLoader.getInstance() will find them. */
export function constructResourceLoaderSingletons(): Disposable[] {
  ResourceLoader.registerInstance(CCLOUD_CONNECTION_ID, CCloudResourceLoader.getInstance());
  ResourceLoader.registerInstance(LOCAL_CONNECTION_ID, LocalResourceLoader.getInstance());

  return ResourceLoader.getDisposables();
}
