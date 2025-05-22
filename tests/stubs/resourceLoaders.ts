import { SinonSandbox, SinonStubbedInstance } from "sinon";
import { CCLOUD_CONNECTION_ID, LOCAL_CONNECTION_ID } from "../../src/constants";
import {
  CCloudResourceLoader,
  DirectResourceLoader,
  LocalResourceLoader,
  ResourceLoader,
} from "../../src/loaders";

/**
 * Creates a stubbed instance of the abstract {@link ResourceLoader} class.
 *
 * NOTE: This function stubs the static `getInstance()` method as well as the abstract methods of
 * the {@link ResourceLoader} class.
 *
 * @param sandbox The {@link SinonSandbox} to use for creating stubs.
 * @returns A {@link SinonStubbedInstance} of the {@link ResourceLoader} class.
 */
export function getStubbedResourceLoader(
  sandbox: SinonSandbox,
): SinonStubbedInstance<ResourceLoader> {
  const stubbedLoader: SinonStubbedInstance<ResourceLoader> =
    sandbox.createStubInstance(ResourceLoader);
  // add stubs for abstract methods
  stubbedLoader.getEnvironments = sandbox.stub();
  stubbedLoader.getKafkaClustersForEnvironmentId = sandbox.stub();
  stubbedLoader.getSchemaRegistries = sandbox.stub();
  stubbedLoader.getSchemaRegistryForEnvironmentId = sandbox.stub();
  stubbedLoader.getTopicSubjectGroups = sandbox.stub();
  // stub the static method to return the stubbed instance
  sandbox.stub(ResourceLoader, "getInstance").returns(stubbedLoader);
  return stubbedLoader;
}

/**
 * Creates a stubbed instance of the {@link CCloudResourceLoader} class.
 *
 * This function stubs the static `getInstance()` methods of both {@link CCloudResourceLoader}
 * and {@link ResourceLoader} (when called with {@linkcode CCLOUD_CONNECTION_ID}) to return
 * the created stub.
 *
 * @param sandbox The {@link SinonSandbox} to use for creating stubs.
 * @returns A {@link SinonStubbedInstance} of the {@link CCloudResourceLoader} class.
 */
export function getStubbedCCloudResourceLoader(
  sandbox: SinonSandbox,
): SinonStubbedInstance<CCloudResourceLoader> {
  const stubbedLoader: SinonStubbedInstance<CCloudResourceLoader> =
    sandbox.createStubInstance(CCloudResourceLoader);
  // stub the static methods to return the stubbed instance
  sandbox.stub(CCloudResourceLoader, "getInstance").returns(stubbedLoader);
  sandbox.stub(ResourceLoader, "getInstance").withArgs(CCLOUD_CONNECTION_ID).returns(stubbedLoader);
  return stubbedLoader;
}

/**
 * Creates a stubbed instance of the {@link LocalResourceLoader} class.
 *
 * This function stubs the static `getInstance()` methods of both {@link LocalResourceLoader}
 * and {@link ResourceLoader} (when called with {@linkcode LOCAL_CONNECTION_ID}) to return
 * the created stub.
 *
 * @param sandbox The {@link SinonSandbox} to use for creating stubs.
 * @returns A {@link SinonStubbedInstance} of the {@link LocalResourceLoader} class.
 */
export function getStubbedLocalResourceLoader(
  sandbox: SinonSandbox,
): SinonStubbedInstance<LocalResourceLoader> {
  const stubbedLoader: SinonStubbedInstance<LocalResourceLoader> =
    sandbox.createStubInstance(LocalResourceLoader);
  // stub the static methods to return the stubbed instance
  sandbox.stub(LocalResourceLoader, "getInstance").returns(stubbedLoader);
  sandbox.stub(ResourceLoader, "getInstance").withArgs(LOCAL_CONNECTION_ID).returns(stubbedLoader);
  return stubbedLoader;
}

/**
 * Creates a stubbed instance of the {@link DirectResourceLoader} class.
 *
 * This function stubs the static `getInstance()` method of {@link DirectResourceLoader}
 * and conditionally stubs the {@link ResourceLoader.getInstance} method for connection IDs
 * that are not {@linkcode CCLOUD_CONNECTION_ID} or {@linkcode LOCAL_CONNECTION_ID}.
 *
 * Unlike the other stub functions, this preserves any existing stubs for the `CCLOUD` and `LOCAL`
 * connections.
 *
 * @param sandbox The {@link SinonSandbox} to use for creating stubs.
 * @returns A {@link SinonStubbedInstance} of the {@link DirectResourceLoader} class.
 */
export function getStubbedDirectResourceLoader(
  sandbox: SinonSandbox,
): SinonStubbedInstance<DirectResourceLoader> {
  const stubbedLoader: SinonStubbedInstance<DirectResourceLoader> =
    sandbox.createStubInstance(DirectResourceLoader);
  // stub the static methods to return the stubbed instance
  sandbox.stub(DirectResourceLoader, "getInstance").returns(stubbedLoader);
  const originalGetInstance = ResourceLoader.getInstance;
  sandbox.stub(ResourceLoader, "getInstance").callsFake((connectionId) => {
    // only stub the getInstance method for non-local and non-ccloud connections. otherwise, return
    // the original instance (and if those are stubbed as well from the above functions, return
    // those stubbed instances)
    if (connectionId === CCLOUD_CONNECTION_ID || connectionId === LOCAL_CONNECTION_ID) {
      return originalGetInstance.call(ResourceLoader, connectionId);
    }
    return stubbedLoader;
  });

  return stubbedLoader;
}
