import * as assert from "assert";
import * as sinon from "sinon";
import { SchemaRegistryProxy, createSchemaRegistryProxy } from "./schemaRegistryProxy";
import type { SchemaRegistryProxyConfig } from "./schemaRegistryProxy";
import { HttpError } from "./httpClient";

describe("proxy/schemaRegistryProxy", function () {
  let fetchStub: sinon.SinonStub;
  let proxy: SchemaRegistryProxy;

  const defaultConfig: SchemaRegistryProxyConfig = {
    baseUrl: "https://schema-registry.example.com",
    timeout: 5000,
  };

  function mockResponse<T>(data: T, status = 200): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "Error",
      headers: new Headers({
        "content-type": "application/json",
      }),
      json: () => Promise.resolve(data),
      text: () => Promise.resolve(JSON.stringify(data)),
    } as Response;
  }

  beforeEach(function () {
    fetchStub = sinon.stub(globalThis, "fetch");
    proxy = new SchemaRegistryProxy(defaultConfig);
  });

  afterEach(function () {
    sinon.restore();
  });

  describe("constructor", function () {
    it("should create proxy with config", function () {
      const testProxy = new SchemaRegistryProxy(defaultConfig);
      fetchStub.resolves(mockResponse([]));

      void testProxy.listSubjects();

      assert.ok(fetchStub.calledOnce);
      const url = fetchStub.firstCall.args[0];
      assert.ok(url.startsWith("https://schema-registry.example.com"));
    });

    it("should accept auth configuration", function () {
      const configWithAuth: SchemaRegistryProxyConfig = {
        ...defaultConfig,
        auth: { type: "basic", username: "user", password: "pass" },
      };

      const testProxy = new SchemaRegistryProxy(configWithAuth);
      fetchStub.resolves(mockResponse([]));

      void testProxy.listSubjects();

      const [, options] = fetchStub.firstCall.args;
      const expected = "Basic " + Buffer.from("user:pass").toString("base64");
      assert.strictEqual(options.headers["Authorization"], expected);
    });
  });

  describe("listSubjects()", function () {
    it("should list all subjects", async function () {
      fetchStub.resolves(mockResponse(["subject-1", "subject-2", "subject-3"]));

      const result = await proxy.listSubjects();

      assert.strictEqual(result.length, 3);
      assert.strictEqual(result[0], "subject-1");
      const url = String(fetchStub.firstCall.args[0]);
      assert.ok(url.includes("/subjects"), `Expected URL to include /subjects, got: ${url}`);
    });

    it("should filter by prefix", async function () {
      fetchStub.resolves(mockResponse(["topic-value", "topic-key"]));

      await proxy.listSubjects({ subjectPrefix: "topic" });

      const url = fetchStub.firstCall.args[0];
      assert.ok(url.includes("subjectPrefix=topic"));
    });

    it("should include deleted subjects when requested", async function () {
      fetchStub.resolves(mockResponse([]));

      await proxy.listSubjects({ deleted: true });

      const url = fetchStub.firstCall.args[0];
      assert.ok(url.includes("deleted=true"));
    });
  });

  describe("listVersions()", function () {
    it("should list versions for a subject", async function () {
      fetchStub.resolves(mockResponse([1, 2, 3]));

      const result = await proxy.listVersions("my-subject");

      assert.deepStrictEqual(result, [1, 2, 3]);
      const url = fetchStub.firstCall.args[0];
      assert.ok(url.includes("/subjects/my-subject/versions"));
    });

    it("should encode subject name in URL", async function () {
      fetchStub.resolves(mockResponse([1]));

      await proxy.listVersions("my/subject");

      const url = fetchStub.firstCall.args[0];
      assert.ok(url.includes("my%2Fsubject"));
    });
  });

  describe("getSchemaByVersion()", function () {
    it("should get schema by version number", async function () {
      const schema = {
        subject: "my-subject",
        version: 1,
        id: 100,
        schemaType: "AVRO",
        schema: '{"type":"record"}',
      };
      fetchStub.resolves(mockResponse(schema));

      const result = await proxy.getSchemaByVersion("my-subject", 1);

      assert.strictEqual(result.id, 100);
      assert.strictEqual(result.schemaType, "AVRO");
    });

    it("should get latest schema", async function () {
      fetchStub.resolves(mockResponse({ version: 5 }));

      const result = await proxy.getSchemaByVersion("my-subject", "latest");

      assert.strictEqual(result.version, 5);
      const url = fetchStub.firstCall.args[0];
      assert.ok(url.includes("/versions/latest"));
    });
  });

  describe("getLatestSchema()", function () {
    it("should get the latest schema", async function () {
      fetchStub.resolves(mockResponse({ subject: "my-subject", version: 3 }));

      const result = await proxy.getLatestSchema("my-subject");

      assert.strictEqual(result.version, 3);
      const url = fetchStub.firstCall.args[0];
      assert.ok(url.includes("/versions/latest"));
    });
  });

  describe("getSchemaById()", function () {
    it("should get schema by ID", async function () {
      fetchStub.resolves(mockResponse({ id: 12345, schema: '{"type":"string"}' }));

      const result = await proxy.getSchemaById(12345);

      assert.strictEqual(result.id, 12345);
      const url = fetchStub.firstCall.args[0];
      assert.ok(url.includes("/schemas/ids/12345"));
    });
  });

  describe("getSchemaString()", function () {
    it("should get raw schema string", async function () {
      fetchStub.resolves(mockResponse('{"type":"record","name":"Test"}'));

      const result = await proxy.getSchemaString("my-subject", 1);

      assert.strictEqual(result, '{"type":"record","name":"Test"}');
      const url = fetchStub.firstCall.args[0];
      assert.ok(url.includes("/versions/1/schema"));
    });
  });

  describe("listSchemas()", function () {
    it("should list all schemas", async function () {
      const schemas = [
        { id: 1, subject: "topic-1-value" },
        { id: 2, subject: "topic-2-value" },
      ];
      fetchStub.resolves(mockResponse(schemas));

      const result = await proxy.listSchemas();

      assert.strictEqual(result.length, 2);
    });

    it("should support pagination", async function () {
      fetchStub.resolves(mockResponse([]));

      await proxy.listSchemas({ offset: 10, limit: 50 });

      const url = fetchStub.firstCall.args[0];
      assert.ok(url.includes("offset=10"));
      assert.ok(url.includes("limit=50"));
    });

    it("should filter to latest only", async function () {
      fetchStub.resolves(mockResponse([]));

      await proxy.listSchemas({ latestOnly: true });

      const url = fetchStub.firstCall.args[0];
      assert.ok(url.includes("latestOnly=true"));
    });
  });

  describe("getSubjectsForSchemaId()", function () {
    it("should get subjects for a schema ID", async function () {
      fetchStub.resolves(mockResponse(["subject-1", "subject-2"]));

      const result = await proxy.getSubjectsForSchemaId(100);

      assert.deepStrictEqual(result, ["subject-1", "subject-2"]);
    });
  });

  describe("getVersionsForSchemaId()", function () {
    it("should get subject-version pairs for a schema ID", async function () {
      const versions = [
        { subject: "topic-value", version: 1 },
        { subject: "topic-value", version: 2 },
      ];
      fetchStub.resolves(mockResponse(versions));

      const result = await proxy.getVersionsForSchemaId(100);

      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].subject, "topic-value");
    });
  });

  describe("listSchemaTypes()", function () {
    it("should list supported schema types", async function () {
      fetchStub.resolves(mockResponse(["AVRO", "JSON", "PROTOBUF"]));

      const result = await proxy.listSchemaTypes();

      assert.deepStrictEqual(result, ["AVRO", "JSON", "PROTOBUF"]);
    });
  });

  describe("registerSchema()", function () {
    it("should register a new schema", async function () {
      fetchStub.resolves(mockResponse({ id: 999 }));

      const result = await proxy.registerSchema({
        subject: "my-topic-value",
        schemaType: "AVRO",
        schema: '{"type":"record","name":"Test","fields":[]}',
      });

      assert.strictEqual(result.id, 999);
      const [, options] = fetchStub.firstCall.args;
      assert.strictEqual(options.method, "POST");
      const body = JSON.parse(options.body);
      assert.strictEqual(body.schemaType, "AVRO");
    });

    it("should register schema with references", async function () {
      fetchStub.resolves(mockResponse({ id: 1000 }));

      await proxy.registerSchema({
        subject: "my-topic-value",
        schema: '{"type":"record"}',
        references: [{ name: "Address", subject: "address-value", version: 1 }],
      });

      const [, options] = fetchStub.firstCall.args;
      const body = JSON.parse(options.body);
      assert.strictEqual(body.references.length, 1);
      assert.strictEqual(body.references[0].name, "Address");
    });

    it("should support normalize option", async function () {
      fetchStub.resolves(mockResponse({ id: 1 }));

      await proxy.registerSchema({
        subject: "test",
        schema: "{}",
        normalize: true,
      });

      const url = fetchStub.firstCall.args[0];
      assert.ok(url.includes("normalize=true"));
    });
  });

  describe("lookupSchema()", function () {
    it("should look up existing schema", async function () {
      fetchStub.resolves(mockResponse({ id: 50, version: 2 }));

      const result = await proxy.lookupSchema("my-subject", {
        schemaType: "AVRO",
        schema: '{"type":"record"}',
      });

      assert.strictEqual(result.id, 50);
      const url = fetchStub.firstCall.args[0];
      assert.ok(url.endsWith("/subjects/my-subject"));
    });
  });

  describe("deleteSubject()", function () {
    it("should soft delete a subject", async function () {
      fetchStub.resolves(mockResponse([1, 2, 3]));

      const result = await proxy.deleteSubject("my-subject");

      assert.deepStrictEqual(result, [1, 2, 3]);
      const [, options] = fetchStub.firstCall.args;
      assert.strictEqual(options.method, "DELETE");
    });

    it("should hard delete when permanent is true", async function () {
      fetchStub.resolves(mockResponse([1]));

      await proxy.deleteSubject("my-subject", { permanent: true });

      const url = fetchStub.firstCall.args[0];
      assert.ok(url.includes("permanent=true"));
    });
  });

  describe("deleteSchemaVersion()", function () {
    it("should delete a specific version", async function () {
      fetchStub.resolves(mockResponse(1));

      const result = await proxy.deleteSchemaVersion("my-subject", 1);

      assert.strictEqual(result, 1);
      const url = fetchStub.firstCall.args[0];
      assert.ok(url.includes("/versions/1"));
    });
  });

  describe("getGlobalConfig()", function () {
    it("should get global compatibility config", async function () {
      fetchStub.resolves(mockResponse({ compatibilityLevel: "BACKWARD" }));

      const result = await proxy.getGlobalConfig();

      assert.strictEqual(result.compatibilityLevel, "BACKWARD");
    });
  });

  describe("setGlobalConfig()", function () {
    it("should set global compatibility", async function () {
      fetchStub.resolves(mockResponse({ compatibilityLevel: "FULL" }));

      const result = await proxy.setGlobalConfig("FULL");

      assert.strictEqual(result.compatibilityLevel, "FULL");
      const [, options] = fetchStub.firstCall.args;
      assert.strictEqual(options.method, "PUT");
    });
  });

  describe("getSubjectConfig()", function () {
    it("should get subject-level config", async function () {
      fetchStub.resolves(mockResponse({ compatibilityLevel: "NONE" }));

      const result = await proxy.getSubjectConfig("my-subject");

      assert.strictEqual(result.compatibilityLevel, "NONE");
    });
  });

  describe("setSubjectConfig()", function () {
    it("should set subject-level config", async function () {
      fetchStub.resolves(mockResponse({ compatibilityLevel: "FORWARD" }));

      const result = await proxy.setSubjectConfig("my-subject", "FORWARD");

      assert.strictEqual(result.compatibilityLevel, "FORWARD");
    });
  });

  describe("deleteSubjectConfig()", function () {
    it("should delete subject-level config", async function () {
      fetchStub.resolves(mockResponse("BACKWARD"));

      const result = await proxy.deleteSubjectConfig("my-subject");

      assert.strictEqual(result, "BACKWARD");
    });
  });

  describe("checkCompatibility()", function () {
    it("should check compatibility", async function () {
      fetchStub.resolves(mockResponse({ is_compatible: true }));

      const result = await proxy.checkCompatibility({
        subject: "my-subject",
        schema: '{"type":"record"}',
      });

      assert.strictEqual(result.is_compatible, true);
      const url = fetchStub.firstCall.args[0];
      assert.ok(url.includes("/compatibility/subjects/my-subject/versions/latest"));
    });

    it("should check against specific version", async function () {
      fetchStub.resolves(mockResponse({ is_compatible: false }));

      await proxy.checkCompatibility({
        subject: "my-subject",
        schema: "{}",
        version: "1",
      });

      const url = fetchStub.firstCall.args[0];
      assert.ok(url.includes("/versions/1"));
    });

    it("should support verbose mode", async function () {
      fetchStub.resolves(mockResponse({ is_compatible: false, messages: ["error"] }));

      await proxy.checkCompatibility({
        subject: "my-subject",
        schema: "{}",
        verbose: true,
      });

      const url = fetchStub.firstCall.args[0];
      assert.ok(url.includes("verbose=true"));
    });
  });

  describe("subjectExists()", function () {
    it("should return true when subject exists", async function () {
      fetchStub.resolves(mockResponse([1, 2, 3]));

      const result = await proxy.subjectExists("existing-subject");

      assert.strictEqual(result, true);
    });

    it("should return false when subject does not exist", async function () {
      fetchStub.resolves(mockResponse({ error_code: 40401 }, 404));

      const result = await proxy.subjectExists("non-existent");

      assert.strictEqual(result, false);
    });

    it("should throw on other errors", async function () {
      fetchStub.resolves(mockResponse({ error: "Server error" }, 500));

      await assert.rejects(() => proxy.subjectExists("some-subject"), HttpError);
    });
  });

  describe("getReferencedBy()", function () {
    it("should get schemas that reference this schema", async function () {
      fetchStub.resolves(mockResponse([101, 102, 103]));

      const result = await proxy.getReferencedBy("my-subject", 1);

      assert.deepStrictEqual(result, [101, 102, 103]);
      const url = fetchStub.firstCall.args[0];
      assert.ok(url.includes("/referencedby"));
    });
  });

  describe("createSchemaRegistryProxy()", function () {
    it("should create a proxy with config", function () {
      const testProxy = createSchemaRegistryProxy(defaultConfig);
      fetchStub.resolves(mockResponse([]));

      void testProxy.listSubjects();

      assert.ok(fetchStub.calledOnce);
    });
  });
});
