import assert from "assert";
import sinon from "sinon";
import { TEST_CCLOUD_SCHEMA } from "../../tests/unit/testResources";
import { SchemaString, SchemasV1Api } from "../clients/schemaRegistryRest";
import * as sidecar from "../sidecar";
import { SchemaDocumentProvider } from "./schema";

describe("DiffableReadOnlyDocumentProvider tests", function () {
  let sandbox: sinon.SinonSandbox;
  let mockSidecarHandle: sinon.SinonStubbedInstance<sidecar.SidecarHandle>;
  let mockClient: sinon.SinonStubbedInstance<SchemasV1Api>;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    // create the stubs for the sidecar + service client
    mockSidecarHandle = sandbox.createStubInstance(sidecar.SidecarHandle);
    mockClient = sandbox.createStubInstance(SchemasV1Api);
    mockSidecarHandle.getSchemasV1Api.returns(mockClient);
    // stub the getSidecar function to return the mock sidecar handle
    sandbox.stub(sidecar, "getSidecar").resolves(mockSidecarHandle);
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("should return a schema definition from a schema URI", async () => {
    const provider = new SchemaDocumentProvider();

    const uri = provider.resourceToUri(TEST_CCLOUD_SCHEMA, TEST_CCLOUD_SCHEMA.fileName());

    const schemaResp: SchemaString = { schema: '{"foo": "bar"}', schemaType: "JSON" };
    mockClient.getSchema.resolves(schemaResp);

    const schemaDefinition = await provider.provideTextDocumentContent(uri);

    assert.ok(
      mockSidecarHandle.getSchemasV1Api.calledOnceWithExactly(
        TEST_CCLOUD_SCHEMA.schemaRegistryId,
        TEST_CCLOUD_SCHEMA.connectionId,
      ),
    );
    assert.strictEqual(schemaDefinition, JSON.stringify(JSON.parse('{"foo": "bar"}'), null, 2));
  });
});
