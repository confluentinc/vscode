import * as sinon from "sinon";
import { BaseAPI as SchemaRegistryRestBaseAPI } from "../../src/clients/schemaRegistryRest/runtime";

const fakeResponse = new Response("{}", {
  status: 200,
  statusText: "OK",
  headers: { "Content-Type": "application/json" },
});

export function setupGlobalApiStubs() {
  stubSchemaRegistryApi();

  // add others here
}

let originalSchemaRegistryApi: (typeof SchemaRegistryRestBaseAPI.prototype)["request"] | undefined;
export let schemaRegistryApiStub: sinon.SinonStub | undefined;
export function stubSchemaRegistryApi() {
  originalSchemaRegistryApi = SchemaRegistryRestBaseAPI.prototype["request"];
  schemaRegistryApiStub = sinon.stub().callsFake(async () => fakeResponse);
  SchemaRegistryRestBaseAPI.prototype["request"] = schemaRegistryApiStub;
}

export function restoreSchemaRegistryApi() {
  if (originalSchemaRegistryApi) {
    SchemaRegistryRestBaseAPI.prototype["request"] = originalSchemaRegistryApi;
  }
  schemaRegistryApiStub?.reset();
}
