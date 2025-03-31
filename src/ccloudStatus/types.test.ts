import * as assert from "assert";
import {
  TEST_CCLOUD_AFFECTED_COMPONENT,
  TEST_CCLOUD_INCIDENT,
  TEST_CCLOUD_INCIDENT_UPDATE,
  TEST_CCLOUD_SCHEDULED_MAINTENANCE,
  TEST_CCLOUD_SCHEDULED_MAINTENANCE_UPDATE,
  TEST_CCLOUD_STATUS_COMPONENT,
  TEST_CCLOUD_STATUS_PAGE,
  TEST_CCLOUD_STATUS_SUMMARY,
  TEST_CCLOUD_SUMMARY_STATUS,
} from "../../tests/unit/testResources/ccloudStatus";
import {
  AffectedComponent,
  AffectedComponentFromJSON,
  CCloudStatusSummary,
  CCloudStatusSummaryFromJSON,
  Incident,
  IncidentFromJSON,
  ScheduledMaintenance,
  ScheduledMaintenanceFromJSON,
  StatusComponent,
  StatusComponentFromJSON,
  StatusPage,
  StatusPageFromJSON,
  StatusUpdate,
  StatusUpdateFromJSON,
  SummaryStatus,
  SummaryStatusFromJSON,
} from "./types";

describe("ccloudStatus/types.ts StatusPageFromJSON()", () => {
  it("should convert valid JSON to a StatusPage object", () => {
    const json = JSON.parse(JSON.stringify(TEST_CCLOUD_STATUS_PAGE));

    const result: StatusPage = StatusPageFromJSON(json);

    assert.deepStrictEqual(result, TEST_CCLOUD_STATUS_PAGE);
  });

  it("should handle empty input", () => {
    assert.strictEqual(StatusPageFromJSON(null), null);
    assert.strictEqual(StatusPageFromJSON(undefined), undefined);
  });
});

describe("ccloudStatus/types.ts StatusComponentFromJSON()", () => {
  it("should convert valid JSON to a StatusComponent object", () => {
    const json = JSON.parse(JSON.stringify(TEST_CCLOUD_STATUS_COMPONENT));

    const result: StatusComponent = StatusComponentFromJSON(json);

    assert.deepStrictEqual(result, TEST_CCLOUD_STATUS_COMPONENT);
  });

  it("should handle empty input", () => {
    assert.strictEqual(StatusComponentFromJSON(null), null);
    assert.strictEqual(StatusComponentFromJSON(undefined), undefined);
  });
});

describe("ccloudStatus/types.ts AffectedComponentFromJSON()", () => {
  it("should convert valid JSON to an AffectedComponent object", () => {
    const json = JSON.parse(JSON.stringify(TEST_CCLOUD_AFFECTED_COMPONENT));

    const result: AffectedComponent = AffectedComponentFromJSON(json);

    assert.deepStrictEqual(result, TEST_CCLOUD_AFFECTED_COMPONENT);
  });

  it("should handle empty input", () => {
    assert.strictEqual(AffectedComponentFromJSON(null), null);
    assert.strictEqual(AffectedComponentFromJSON(undefined), undefined);
  });
});

describe("ccloudStatus/types.ts StatusUpdateFromJSON()", () => {
  it("should convert valid incident update JSON to a StatusUpdate object", () => {
    const json = JSON.parse(JSON.stringify(TEST_CCLOUD_INCIDENT_UPDATE));

    const result: StatusUpdate = StatusUpdateFromJSON(json);

    assert.deepStrictEqual(result, TEST_CCLOUD_INCIDENT_UPDATE);
  });

  it("should convert valid scheduled maintenance update JSON to a StatusUpdate object", () => {
    const json = JSON.parse(JSON.stringify(TEST_CCLOUD_SCHEDULED_MAINTENANCE_UPDATE));

    const result: StatusUpdate = StatusUpdateFromJSON(json);

    assert.deepStrictEqual(result, TEST_CCLOUD_SCHEDULED_MAINTENANCE_UPDATE);
  });

  it("should handle empty input", () => {
    assert.strictEqual(StatusUpdateFromJSON(null), null);
    assert.strictEqual(StatusUpdateFromJSON(undefined), undefined);
  });

  it("should handle missing 'affected_components'", () => {
    const json = {
      ...JSON.parse(JSON.stringify(TEST_CCLOUD_INCIDENT_UPDATE)),
      affected_components: undefined,
    };

    const result: StatusUpdate = StatusUpdateFromJSON(json);

    assert.ok(Array.isArray(result.affected_components));
    assert.strictEqual(result.affected_components.length, 0);
  });
});

describe("ccloudStatus/types.ts IncidentFromJSON()", () => {
  it("should convert valid JSON to an Incident object", () => {
    const json = JSON.parse(JSON.stringify(TEST_CCLOUD_INCIDENT));

    const result: Incident = IncidentFromJSON(json);

    assert.deepStrictEqual(result, TEST_CCLOUD_INCIDENT);
  });

  it("should handle empty input", () => {
    assert.strictEqual(IncidentFromJSON(null), null);
    assert.strictEqual(IncidentFromJSON(undefined), undefined);
  });

  it("should handle missing 'incident_updates' and 'components'", () => {
    const json = {
      ...JSON.parse(JSON.stringify(TEST_CCLOUD_INCIDENT)),
      incident_updates: undefined,
      components: undefined,
    };

    const result: Incident = IncidentFromJSON(json);

    assert.ok(Array.isArray(result.incident_updates));
    assert.strictEqual(result.incident_updates.length, 0);
    assert.ok(Array.isArray(result.components));
    assert.strictEqual(result.components.length, 0);
  });
});

describe("ccloudStatus/types.ts ScheduledMaintenanceFromJSON()", () => {
  it("should convert valid JSON to a ScheduledMaintenance object", () => {
    const json = JSON.parse(JSON.stringify(TEST_CCLOUD_SCHEDULED_MAINTENANCE));

    const result: ScheduledMaintenance = ScheduledMaintenanceFromJSON(json);

    assert.deepStrictEqual(result, TEST_CCLOUD_SCHEDULED_MAINTENANCE);
  });

  it("should handle empty input", () => {
    assert.strictEqual(ScheduledMaintenanceFromJSON(null), null);
    assert.strictEqual(ScheduledMaintenanceFromJSON(undefined), undefined);
  });

  it("should handle missing 'incident_updates' and 'components'", () => {
    const json = {
      ...JSON.parse(JSON.stringify(TEST_CCLOUD_SCHEDULED_MAINTENANCE)),
      incident_updates: undefined,
      components: undefined,
    };

    const result: ScheduledMaintenance = ScheduledMaintenanceFromJSON(json);

    assert.ok(Array.isArray(result.incident_updates));
    assert.strictEqual(result.incident_updates.length, 0);
    assert.ok(Array.isArray(result.components));
    assert.strictEqual(result.components.length, 0);
  });

  it("should set 'impact' to 'maintenance' if not provided", () => {
    const json = {
      ...JSON.parse(JSON.stringify(TEST_CCLOUD_SCHEDULED_MAINTENANCE)),
      impact: undefined,
    };

    const result: ScheduledMaintenance = ScheduledMaintenanceFromJSON(json);

    assert.strictEqual(result.impact, "maintenance");
  });

  it("should use existing 'impact' if provided", () => {
    const json = {
      ...JSON.parse(JSON.stringify(TEST_CCLOUD_SCHEDULED_MAINTENANCE)),
      impact: "major",
    };

    const result: ScheduledMaintenance = ScheduledMaintenanceFromJSON(json);

    assert.strictEqual(result.impact, "major");
  });
});

describe("ccloudStatus/types.ts SummaryStatusFromJSON()", () => {
  it("should convert valid JSON to a SummaryStatus object", () => {
    const json = JSON.parse(JSON.stringify(TEST_CCLOUD_SUMMARY_STATUS));

    const result: SummaryStatus = SummaryStatusFromJSON(json);

    assert.deepStrictEqual(result, TEST_CCLOUD_SUMMARY_STATUS);
  });

  it("should handle empty input", () => {
    assert.strictEqual(SummaryStatusFromJSON(null), null);
    assert.strictEqual(SummaryStatusFromJSON(undefined), undefined);
  });
});

describe("ccloudStatus/types.ts CCloudStatusSummaryFromJSON()", () => {
  it("should convert valid JSON to a CCloudStatusSummary object", () => {
    const json = JSON.parse(JSON.stringify(TEST_CCLOUD_STATUS_SUMMARY));

    const result: CCloudStatusSummary = CCloudStatusSummaryFromJSON(json);

    assert.deepStrictEqual(result, TEST_CCLOUD_STATUS_SUMMARY);
  });

  it("should handle empty input", () => {
    assert.strictEqual(CCloudStatusSummaryFromJSON(null), null);
    assert.strictEqual(CCloudStatusSummaryFromJSON(undefined), undefined);
  });

  it("should handle missing 'components', 'incidents', and 'scheduled_maintenances'", () => {
    const json = {
      ...JSON.parse(JSON.stringify(TEST_CCLOUD_STATUS_SUMMARY)),
      components: [],
      incidents: [],
      scheduled_maintenances: [],
    };

    const result: CCloudStatusSummary = CCloudStatusSummaryFromJSON(json);

    assert.ok(Array.isArray(result.components));
    assert.strictEqual(result.components.length, 0);
    assert.ok(Array.isArray(result.incidents));
    assert.strictEqual(result.incidents.length, 0);
    assert.ok(Array.isArray(result.scheduled_maintenances));
    assert.strictEqual(result.scheduled_maintenances.length, 0);
  });
});
