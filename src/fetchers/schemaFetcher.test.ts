import * as assert from "assert";
import * as sinon from "sinon";
import { createSchemaFetcher } from "./schemaFetcher";
import { SchemaFetchError } from "./types";
import { ConnectionType } from "../clients/sidecar";
import { CCLOUD_CONNECTION_ID } from "../constants";
import type { SchemaRegistry } from "../models/schemaRegistry";
import { SchemaType } from "../models/schema";

describe("fetchers/schemaFetcher", function () {
  let fetchStub: sinon.SinonStub;

  const mockSchemaRegistry: SchemaRegistry = {
    connectionId: CCLOUD_CONNECTION_ID,
    connectionType: ConnectionType.Ccloud,
    id: "lsrc-123",
    uri: "https://psrc-123.us-east-1.aws.confluent.cloud",
    environmentId: "env-123" as any,
    name: "Schema Registry",
    schemaRegistryId: "lsrc-123",
    iconName: "schema-registry" as any,
    searchableText: () => "Schema Registry lsrc-123",
  } as SchemaRegistry;

  function mockResponse<T>(data: T, status = 200): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "Error",
      headers: new Headers({ "content-type": "application/json" }),
      json: () => Promise.resolve(data),
      text: () => Promise.resolve(JSON.stringify(data)),
    } as Response;
  }

  beforeEach(function () {
    fetchStub = sinon.stub(globalThis, "fetch");
  });

  afterEach(function () {
    sinon.restore();
  });

  describe("createSchemaFetcher()", function () {
    it("should create a schema fetcher", function () {
      const fetcher = createSchemaFetcher({
        getAuthConfig: () => undefined,
      });
      assert.ok(fetcher);
      assert.ok(typeof fetcher.fetchSubjects === "function");
      assert.ok(typeof fetcher.fetchVersions === "function");
      assert.ok(typeof fetcher.fetchSchemasForSubject === "function");
      assert.ok(typeof fetcher.deleteSchemaVersion === "function");
      assert.ok(typeof fetcher.deleteSubject === "function");
    });
  });

  describe("fetchSubjects()", function () {
    it("should fetch subjects from schema registry", async function () {
      fetchStub.resolves(mockResponse(["subject-a", "subject-b", "subject-c"]));

      const fetcher = createSchemaFetcher({
        getAuthConfig: () => undefined,
      });

      const subjects = await fetcher.fetchSubjects(mockSchemaRegistry);

      assert.strictEqual(subjects.length, 3);
      assert.deepStrictEqual(subjects, ["subject-a", "subject-b", "subject-c"]);
    });

    it("should sort subjects alphabetically", async function () {
      fetchStub.resolves(mockResponse(["zebra-value", "alpha-key", "beta-value"]));

      const fetcher = createSchemaFetcher({
        getAuthConfig: () => undefined,
      });

      const subjects = await fetcher.fetchSubjects(mockSchemaRegistry);

      assert.deepStrictEqual(subjects, ["alpha-key", "beta-value", "zebra-value"]);
    });

    it("should return empty array when no subjects", async function () {
      fetchStub.resolves(mockResponse([]));

      const fetcher = createSchemaFetcher({
        getAuthConfig: () => undefined,
      });

      const subjects = await fetcher.fetchSubjects(mockSchemaRegistry);

      assert.strictEqual(subjects.length, 0);
    });

    it("should throw SchemaFetchError on HTTP error", async function () {
      fetchStub.resolves(mockResponse({ error: "Unauthorized" }, 401));

      const fetcher = createSchemaFetcher({
        getAuthConfig: () => undefined,
      });

      await assert.rejects(() => fetcher.fetchSubjects(mockSchemaRegistry), SchemaFetchError);
    });

    it("should include auth header when provided", async function () {
      fetchStub.resolves(mockResponse([]));

      const fetcher = createSchemaFetcher({
        getAuthConfig: () => ({ type: "bearer", token: "sr-token" }),
      });

      await fetcher.fetchSubjects(mockSchemaRegistry);

      const [, options] = fetchStub.firstCall.args;
      assert.strictEqual(options.headers["Authorization"], "Bearer sr-token");
    });
  });

  describe("fetchVersions()", function () {
    it("should fetch versions for a subject", async function () {
      fetchStub.resolves(mockResponse([1, 2, 3]));

      const fetcher = createSchemaFetcher({
        getAuthConfig: () => undefined,
      });

      const versions = await fetcher.fetchVersions(mockSchemaRegistry, "test-subject");

      assert.deepStrictEqual(versions, [1, 2, 3]);
    });

    it("should return empty array when no versions", async function () {
      fetchStub.resolves(mockResponse([]));

      const fetcher = createSchemaFetcher({
        getAuthConfig: () => undefined,
      });

      const versions = await fetcher.fetchVersions(mockSchemaRegistry, "test-subject");

      assert.strictEqual(versions.length, 0);
    });

    it("should throw SchemaFetchError on HTTP error", async function () {
      fetchStub.resolves(mockResponse({ error: "Not found" }, 404));

      const fetcher = createSchemaFetcher({
        getAuthConfig: () => undefined,
      });

      await assert.rejects(
        () => fetcher.fetchVersions(mockSchemaRegistry, "nonexistent-subject"),
        SchemaFetchError,
      );
    });
  });

  describe("fetchSchemasForSubject()", function () {
    it("should fetch all schema versions for a subject", async function () {
      // First call: list versions
      fetchStub.onCall(0).resolves(mockResponse([1, 2]));
      // Second call: get version 2 (fetched first due to descending sort)
      fetchStub.onCall(1).resolves(
        mockResponse({
          id: 102,
          subject: "test-subject",
          version: 2,
          schemaType: "AVRO",
        }),
      );
      // Third call: get version 1
      fetchStub.onCall(2).resolves(
        mockResponse({
          id: 101,
          subject: "test-subject",
          version: 1,
          schemaType: "AVRO",
        }),
      );

      const fetcher = createSchemaFetcher({
        getAuthConfig: () => undefined,
      });

      const schemas = await fetcher.fetchSchemasForSubject(mockSchemaRegistry, "test-subject");

      assert.strictEqual(schemas.length, 2);
      // Should be sorted descending by version
      assert.strictEqual(schemas[0].version, 2);
      assert.strictEqual(schemas[1].version, 1);
      // Highest version should be marked
      assert.strictEqual(schemas[0].isHighestVersion, true);
      assert.strictEqual(schemas[1].isHighestVersion, false);
    });

    it("should set correct schema type", async function () {
      fetchStub.onCall(0).resolves(mockResponse([1]));
      fetchStub.onCall(1).resolves(
        mockResponse({
          id: 100,
          subject: "test-subject",
          version: 1,
          schemaType: "JSON",
        }),
      );

      const fetcher = createSchemaFetcher({
        getAuthConfig: () => undefined,
      });

      const schemas = await fetcher.fetchSchemasForSubject(mockSchemaRegistry, "test-subject");

      assert.strictEqual(schemas[0].type, SchemaType.Json);
    });

    it("should default to AVRO when schemaType is not present", async function () {
      fetchStub.onCall(0).resolves(mockResponse([1]));
      fetchStub.onCall(1).resolves(
        mockResponse({
          id: 100,
          subject: "test-subject",
          version: 1,
          // No schemaType - defaults to AVRO
        }),
      );

      const fetcher = createSchemaFetcher({
        getAuthConfig: () => undefined,
      });

      const schemas = await fetcher.fetchSchemasForSubject(mockSchemaRegistry, "test-subject");

      assert.strictEqual(schemas[0].type, SchemaType.Avro);
    });

    it("should set schema registry metadata correctly", async function () {
      fetchStub.onCall(0).resolves(mockResponse([1]));
      fetchStub.onCall(1).resolves(
        mockResponse({
          id: 100,
          subject: "test-subject",
          version: 1,
        }),
      );

      const fetcher = createSchemaFetcher({
        getAuthConfig: () => undefined,
      });

      const schemas = await fetcher.fetchSchemasForSubject(mockSchemaRegistry, "test-subject");

      assert.strictEqual(schemas[0].connectionId, mockSchemaRegistry.connectionId);
      assert.strictEqual(schemas[0].connectionType, mockSchemaRegistry.connectionType);
      assert.strictEqual(schemas[0].schemaRegistryId, mockSchemaRegistry.id);
      assert.strictEqual(schemas[0].environmentId, mockSchemaRegistry.environmentId);
    });
  });

  describe("deleteSchemaVersion()", function () {
    it("should delete a schema version (soft delete)", async function () {
      fetchStub.resolves(mockResponse(1, 200));

      const fetcher = createSchemaFetcher({
        getAuthConfig: () => undefined,
      });

      await fetcher.deleteSchemaVersion(mockSchemaRegistry, "test-subject", 1, false);

      assert.strictEqual(fetchStub.callCount, 1);
      const [url, options] = fetchStub.firstCall.args;
      assert.ok(String(url).includes("/subjects/test-subject/versions/1"));
      assert.strictEqual(options.method, "DELETE");
    });

    it("should delete a schema version (hard delete - two requests)", async function () {
      fetchStub.resolves(mockResponse(1, 200));

      const fetcher = createSchemaFetcher({
        getAuthConfig: () => undefined,
      });

      await fetcher.deleteSchemaVersion(mockSchemaRegistry, "test-subject", 1, true);

      // Hard delete requires soft delete first, then hard delete
      assert.strictEqual(fetchStub.callCount, 2);
    });

    it("should throw SchemaFetchError on HTTP error", async function () {
      fetchStub.resolves(mockResponse({ error: "Not found" }, 404));

      const fetcher = createSchemaFetcher({
        getAuthConfig: () => undefined,
      });

      await assert.rejects(
        () => fetcher.deleteSchemaVersion(mockSchemaRegistry, "test-subject", 99, false),
        SchemaFetchError,
      );
    });
  });

  describe("deleteSubject()", function () {
    it("should delete a subject (soft delete)", async function () {
      fetchStub.resolves(mockResponse([1, 2, 3], 200));

      const fetcher = createSchemaFetcher({
        getAuthConfig: () => undefined,
      });

      await fetcher.deleteSubject(mockSchemaRegistry, "test-subject", false);

      assert.strictEqual(fetchStub.callCount, 1);
      const [url, options] = fetchStub.firstCall.args;
      assert.ok(String(url).includes("/subjects/test-subject"));
      assert.strictEqual(options.method, "DELETE");
    });

    it("should delete a subject (hard delete - two requests)", async function () {
      fetchStub.resolves(mockResponse([1, 2, 3], 200));

      const fetcher = createSchemaFetcher({
        getAuthConfig: () => undefined,
      });

      await fetcher.deleteSubject(mockSchemaRegistry, "test-subject", true);

      // Hard delete requires soft delete first, then hard delete
      assert.strictEqual(fetchStub.callCount, 2);
    });

    it("should throw SchemaFetchError on HTTP error", async function () {
      fetchStub.resolves(mockResponse({ error: "Not found" }, 404));

      const fetcher = createSchemaFetcher({
        getAuthConfig: () => undefined,
      });

      await assert.rejects(
        () => fetcher.deleteSubject(mockSchemaRegistry, "nonexistent-subject", false),
        SchemaFetchError,
      );
    });
  });
});
