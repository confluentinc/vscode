import * as assert from "assert";
import { TEST_CCLOUD_CONNECTION } from "../tests/unit/testResources/connection";
import { ResponseError } from "./clients/sidecar";
import { observabilityContext } from "./context/observability";
import { enrichErrorContext } from "./errors";
import { SIDECAR_CONNECTION_ID_HEADER } from "./sidecar/constants";

describe("errors.ts enrichErrorContext()", function () {
  it("should include observabilityContext by default", function () {
    const error = new Error("Test error");

    const context = enrichErrorContext(error);

    assert.deepStrictEqual(context.extra, observabilityContext.toRecord());
  });

  it("should include caller-provided context", function () {
    const error = new Error("Test error");
    const extraContext = { tags: { foo: "bar" } };

    const context = enrichErrorContext(error, extraContext);

    assert.deepStrictEqual(context, { extra: observabilityContext.toRecord(), ...extraContext });
  });

  it("should include merge caller-provided 'extra' context with observability context", function () {
    const error = new Error("Test error");
    const extra = { foo: "bar" };

    const context = enrichErrorContext(error, { extra });

    assert.deepStrictEqual(context.extra, { ...observabilityContext.toRecord(), ...extra });
  });

  it(`should include response status code and "${SIDECAR_CONNECTION_ID_HEADER}" header if provided`, function () {
    const error = new ResponseError(
      new Response("uh oh", {
        status: 404,
        headers: { [SIDECAR_CONNECTION_ID_HEADER]: TEST_CCLOUD_CONNECTION.id },
      }),
    );

    const context = enrichErrorContext(error, { extra: { foo: "bar" } });

    assert.deepStrictEqual(context.contexts.response, {
      status_code: 404,
      headers: { [SIDECAR_CONNECTION_ID_HEADER]: TEST_CCLOUD_CONNECTION.id },
    });
    assert.deepStrictEqual(context.extra, { ...observabilityContext.toRecord(), foo: "bar" });
  });

  it(`should include response context even if ${SIDECAR_CONNECTION_ID_HEADER} header is missing`, function () {
    const error = new ResponseError(new Response("uh oh", { status: 404 }));

    const context = enrichErrorContext(error);

    assert.deepStrictEqual(context.contexts.response, {
      status_code: 404,
      headers: { [SIDECAR_CONNECTION_ID_HEADER]: "" },
    });
    assert.deepStrictEqual(context.extra, observabilityContext.toRecord());
  });
});
