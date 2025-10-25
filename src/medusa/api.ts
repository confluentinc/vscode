import { Configuration } from "../clients/medusa";
import {
  BatchManagementApi,
  ExampleDatasetsApi,
  SchemaManagementApi,
  StreamManagementApi,
  ValueGeneratorsApi,
} from "../clients/medusa/apis";

function createApi<T>(ApiClass: new (config: Configuration) => T) {
  return function (port: number): T {
    const config = new Configuration({ basePath: `http://localhost:${port}` });
    return new ApiClass(config);
  };
}

export const getMedusaValueGeneratorsApi = createApi(ValueGeneratorsApi);
export const getMedusaExampleDatasetsApi = createApi(ExampleDatasetsApi);
export const getMedusaBatchManagementApi = createApi(BatchManagementApi);
export const getMedusaStreamManagementApi = createApi(StreamManagementApi);
export const getMedusaSchemaManagementApi = createApi(SchemaManagementApi);
