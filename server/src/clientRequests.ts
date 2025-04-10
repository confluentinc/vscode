import { getConnection } from "./connection";
import { setKafkaClusters } from "./state";

export function handleRequest(method: string, params: any): Promise<any> | undefined {
  const connection = getConnection();
  connection.console.log(
    `Handling request for method: ${method}: params=${JSON.stringify(params)}`,
  );

  switch (method) {
    case "setKafkaClusters":
      if (params.clusters) {
        setKafkaClusters(params.clusters);
        connection.console.log(`Kafka clusters updated: ${params.clusters}`);
      }
      return Promise.resolve();
    default:
      return undefined;
  }
}
