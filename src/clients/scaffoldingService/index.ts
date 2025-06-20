/* tslint:disable */
/* eslint-disable */
export * from "./apis/index";
export * from "./models/index";
export * from "./runtime";

import { getSidecar } from "../../sidecar";
import { TemplatesScaffoldV1Api } from "./apis";
import { Configuration } from "./runtime";

export async function getScaffoldingService(): Promise<TemplatesScaffoldV1Api> {
  const sidecar = await getSidecar();
  const config = new Configuration({
    basePath: sidecar.defaultClientConfigParams.basePath,
    headers: sidecar.defaultClientConfigParams.headers,
  });
  return new TemplatesScaffoldV1Api(config);
}
