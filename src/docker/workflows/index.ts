import net from "net";
import { window } from "vscode";
import { getLocalKafkaImageName } from "../configs";
import { LocalResourceWorkflow } from "./base";
import { ConfluentLocalWorkflow } from "./confluent-local";

// maybe this can live somewhere else if we need it for more than just container creation:
/** Look for an available port on the host machine and return it. */
export async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close(() => resolve(port));
    });
  });
}

/** Determine which Kafka workflow to use based on the user-selected configuration. */
export function getKafkaWorkflow(): LocalResourceWorkflow {
  const imageRepo: string = getLocalKafkaImageName();
  let workflow: LocalResourceWorkflow;
  switch (imageRepo) {
    case ConfluentLocalWorkflow.imageRepo:
      workflow = ConfluentLocalWorkflow.getInstance();
      break;
    // TODO: add support for other images here (apache/kafka, etc.)
    default: {
      const errorMsg = `Unsupported Kafka image repo: ${imageRepo}`;
      window.showErrorMessage(errorMsg);
      throw new Error(errorMsg);
    }
  }
  return workflow;
}
