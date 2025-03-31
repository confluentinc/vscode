import * as assert from "assert";
import { MarkdownString } from "vscode";
import {
  TEST_CCLOUD_INCIDENT,
  TEST_CCLOUD_SCHEDULED_MAINTENANCE,
  TEST_CCLOUD_STATUS_SUMMARY,
} from "../../tests/unit/testResources/ccloudStatus";
import {
  CCloudStatusSummary,
  ImpactIndicator,
  Incident,
  IncidentStatus,
} from "../ccloudStatus/types";
import { IconNames } from "../constants";
import { titleCase } from "../utils";
import {
  createStatusSummaryMarkdown,
  formatDate,
  formatIncidentOrMaintenanceSection,
  formatStatusGroup,
  getIconForImpact,
  GROUP_HEADER,
  MAX_ITEMS_PER_GROUP,
  SECTION_HEADER,
} from "./formatting";

describe("statusBar/formatting.ts createStatusSummaryMarkdown()", () => {
  it("should return a basic message when there are no incidents or scheduled maintenances", () => {
    const emptySummary: CCloudStatusSummary = {
      ...TEST_CCLOUD_STATUS_SUMMARY,
      incidents: [],
      scheduled_maintenances: [],
    };

    const result: MarkdownString = createStatusSummaryMarkdown(emptySummary);

    assert.ok(result instanceof MarkdownString);
    assert.ok(result.value.includes(`**$(${IconNames.CONFLUENT_LOGO}) Confluent Cloud Status**`));
    assert.ok(result.value.includes("No notices for Confluent Cloud at this time."));
  });

  it("should format the incidents section correctly when incidents are provided", () => {
    const incidentSummary: CCloudStatusSummary = {
      ...TEST_CCLOUD_STATUS_SUMMARY,
      incidents: [{ ...TEST_CCLOUD_INCIDENT, status: "investigating" }],
      scheduled_maintenances: [],
    };

    const result: MarkdownString = createStatusSummaryMarkdown(incidentSummary);

    assert.ok(result instanceof MarkdownString);
    assert.ok(result.value.includes(`**$(${IconNames.CONFLUENT_LOGO}) Confluent Cloud Status**`));
    assert.ok(result.value.includes(`${SECTION_HEADER} Active Incidents`));
    assert.ok(result.value.includes(TEST_CCLOUD_INCIDENT.name));
  });

  it("should format the maintenances section correctly when scheduled maintenances are provided", () => {
    const maintenanceSummary: CCloudStatusSummary = {
      ...TEST_CCLOUD_STATUS_SUMMARY,
      incidents: [],
      scheduled_maintenances: [{ ...TEST_CCLOUD_SCHEDULED_MAINTENANCE, status: "scheduled" }],
    };

    const result: MarkdownString = createStatusSummaryMarkdown(maintenanceSummary);

    assert.ok(result instanceof MarkdownString);
    assert.ok(result.value.includes(`**$(${IconNames.CONFLUENT_LOGO}) Confluent Cloud Status**`));
    assert.ok(result.value.includes(`${SECTION_HEADER} Scheduled Maintenance`));
    assert.ok(result.value.includes(TEST_CCLOUD_SCHEDULED_MAINTENANCE.name));
  });

  it("should format the incidents and maintenances sections correctly, including a separator, when both are provided", () => {
    const bothSummary: CCloudStatusSummary = {
      ...TEST_CCLOUD_STATUS_SUMMARY,
      incidents: [{ ...TEST_CCLOUD_INCIDENT, status: "investigating" }],
      scheduled_maintenances: [{ ...TEST_CCLOUD_SCHEDULED_MAINTENANCE, status: "scheduled" }],
    };

    const result: MarkdownString = createStatusSummaryMarkdown(bothSummary);

    assert.ok(result instanceof MarkdownString);
    assert.ok(result.value.includes(`${SECTION_HEADER} Active Incidents`));
    assert.ok(result.value.includes(`${SECTION_HEADER} Scheduled Maintenance`));
    // should have two separators: one after the header and one between incidents and maintenances
    const separatorCount = (result.value.match(/---/g) || []).length;
    assert.strictEqual(separatorCount, 2);
  });
});

describe("statusBar/formatting.ts formatIncidentOrMaintenanceSection()", () => {
  it("should format 'active' items correctly", () => {
    const items: Incident[] = [
      { ...TEST_CCLOUD_INCIDENT, status: "investigating" },
      { ...TEST_CCLOUD_INCIDENT, status: "identified" },
    ];
    const activeTitle = "Active";
    const activeStatuses: IncidentStatus[] = ["investigating", "identified", "monitoring"];
    const completedTitle = "Finished items";
    const completedStatuses: IncidentStatus[] = ["resolved"];

    const result: string = formatIncidentOrMaintenanceSection(
      items,
      activeTitle,
      activeStatuses,
      completedTitle,
      completedStatuses,
    );

    assert.ok(result.includes(`${SECTION_HEADER} ${activeTitle}`));
    assert.ok(result.includes(`${GROUP_HEADER} Investigating`));
    assert.ok(result.includes(`${GROUP_HEADER} Identified`));
    // nothing from these status groups were passed, so they shouldn't have headers
    assert.ok(!result.includes(`${GROUP_HEADER} Monitoring`));
    assert.ok(!result.includes(`${GROUP_HEADER} Completed`));
  });

  it(`should add a count link when there are more than ${MAX_ITEMS_PER_GROUP} 'active' items`, () => {
    const totalItemCount = MAX_ITEMS_PER_GROUP + 1;
    const items: Incident[] = [];
    for (let i = 0; i < totalItemCount; i++) {
      items.push({
        ...TEST_CCLOUD_INCIDENT,
        status: "investigating",
        id: `unique-id-${i}`,
      } as Incident);
    }

    const activeTitle = "Active";
    const activeStatuses: IncidentStatus[] = ["investigating"];
    const completedTitle = "Completed";
    const completedStatuses: IncidentStatus[] = ["resolved"];

    const result = formatIncidentOrMaintenanceSection(
      items,
      activeTitle,
      activeStatuses,
      completedTitle,
      completedStatuses,
    );

    assert.ok(
      result.includes(
        `${SECTION_HEADER} ${activeTitle} ([${totalItemCount}](https://status.confluent.cloud/))`,
      ),
    );
  });

  it("should include the 'completed' items section when there are completed items", () => {
    const items: Incident[] = [
      { ...TEST_CCLOUD_INCIDENT, status: "investigating" },
      { ...TEST_CCLOUD_INCIDENT, status: "resolved" },
    ];

    const activeTitle = "Active";
    const activeStatuses: IncidentStatus[] = ["investigating"];
    const completedTitle = "Completed items";
    const completedStatuses: IncidentStatus[] = ["resolved"];

    const result: string = formatIncidentOrMaintenanceSection(
      items,
      activeTitle,
      activeStatuses,
      completedTitle,
      completedStatuses,
    );

    assert.ok(result.includes(`${SECTION_HEADER} ${activeTitle}`));
    for (const status of activeStatuses) {
      assert.ok(result.includes(`${GROUP_HEADER} ${titleCase(status)}`));
    }
    assert.ok(result.includes(`${GROUP_HEADER} ${titleCase(completedTitle)}`));
  });
});

describe("statusBar/formatting.ts formatStatusGroup()", () => {
  it("should format a status group with title case", () => {
    const status: IncidentStatus = "monitoring";
    const items: Incident[] = [{ ...TEST_CCLOUD_INCIDENT }];

    const result: string = formatStatusGroup(status, items);

    assert.ok(result.includes(`${GROUP_HEADER} ${titleCase(status)}`));
  });

  it("should include impact icons for items", () => {
    const criticalItem: Incident = { ...TEST_CCLOUD_INCIDENT, impact: "critical" };
    const majorItem: Incident = { ...TEST_CCLOUD_INCIDENT, impact: "major" };

    // status doesn't matter here, just checking the icons from `impact`s
    const result: string = formatStatusGroup("fake status", [criticalItem, majorItem]);

    assert.ok(result.includes("$(error)"));
    assert.ok(result.includes("$(warning)"));
  });

  it(`should only include ${MAX_ITEMS_PER_GROUP} items, sorted by 'updated_at'`, () => {
    const totalItemCount = MAX_ITEMS_PER_GROUP + 1;
    const items: Incident[] = [];
    for (let i = 0; i < totalItemCount; i++) {
      items.push({
        ...TEST_CCLOUD_INCIDENT,
        status: "investigating",
        name: `Incident #${i}`,
        // change the day value based on the index
        updated_at: new Date(2025, 1, i + 1).toISOString(),
      } as Incident);
    }
    const oldestName = items[0].name;
    const newestName = items[totalItemCount - 1].name;

    // status doesn't matter here, just checking item counts and sorting
    const result: string = formatStatusGroup("fake status", items);

    assert.ok(result.includes(newestName));
    assert.ok(!result.includes(oldestName));
  });

  it("should include correctly formatted date strings from 'updated_at'", () => {
    const status = "test_status";
    // zero-indexed month values
    const testDate = new Date(2025, 2, 28, 12, 34).toISOString();
    const item: Incident = {
      ...TEST_CCLOUD_INCIDENT,
      updated_at: testDate,
    };

    const result: string = formatStatusGroup(status, [item]);

    // ignore timezone differences for this test
    assert.ok(result.includes("Mar 28, 12:34"));
  });

  it("should return an empty string if provided an empty item array", () => {
    const items: Incident[] = [];

    // status doesn't matter here
    const result: string = formatStatusGroup("fake status", items);

    assert.strictEqual(result, "");
  });

  it("should use 'In Progress' if status is 'in_progress'", () => {
    const status = "in_progress";
    const items: Incident[] = [{ ...TEST_CCLOUD_INCIDENT }];

    const result: string = formatStatusGroup(status, items);

    assert.ok(result.includes(`${GROUP_HEADER} In Progress`));
  });
});

describe("statusBar/formatting.ts getIconForImpact()", () => {
  it("should return the 'error' icon for critical impact", () => {
    const result: string = getIconForImpact("critical");

    assert.strictEqual(result, "$(error)");
  });

  it("should return the 'warning' icon for major impact", () => {
    const result: string = getIconForImpact("major");

    assert.strictEqual(result, "$(warning)");
  });

  it("should return the 'info' icon for minor impact", () => {
    const result: string = getIconForImpact("minor");

    assert.strictEqual(result, "$(info)");
  });

  it("should return the 'info' icon for none impact", () => {
    const result: string = getIconForImpact("none");

    assert.strictEqual(result, "$(info)");
  });

  it("should return the tools icon for maintenance impact", () => {
    const result: string = getIconForImpact("maintenance");

    assert.strictEqual(result, "$(tools)");
  });

  it("should return an empty string for other impact values", () => {
    const result: string = getIconForImpact("not a real impact" as ImpactIndicator);

    assert.strictEqual(result, "");
  });

  it("should return an empty string when passed undefined", () => {
    const result: string = getIconForImpact(undefined as unknown as ImpactIndicator);

    assert.strictEqual(result, "");
  });
});

describe("statusBar/formatting.ts formatDate()", () => {
  it("should correctly format a valid date/time string", () => {
    // zero-indexed month values
    const testDate = new Date(2025, 2, 28, 12, 34).toISOString();

    const result: string = formatDate(testDate);

    assert.ok(result.includes("Mar 28, 12:34"), result);
  });

  it("should handle invalid date/time values", () => {
    const testDate = "not a date";

    const result: string = formatDate(testDate);

    assert.strictEqual(result, "Unknown date/time");
  });
});
