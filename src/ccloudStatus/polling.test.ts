import { randomUUID } from "crypto";
import {
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
} from "./types";

export const TEST_CCLOUD_COMPONENT_NAME = "Confluent Cloud";

export const TEST_CCLOUD_STATUS_PAGE_ID = randomUUID();

/** @see https://status.confluent.cloud/api/v2/summary.json */
export const TEST_CCLOUD_STATUS_PAGE: StatusPage = StatusPageFromJSON({
  id: TEST_CCLOUD_STATUS_PAGE_ID,
  name: TEST_CCLOUD_COMPONENT_NAME,
  url: "https://status.confluent.cloud",
  time_zone: "Etc/UTC",
  updated_at: Date.now().toString(),
} as StatusPage);

export const TEST_CCLOUD_STATUS_COMPONENT_ID = randomUUID();

/** @see https://status.confluent.cloud/api/v2/summary.json */
export const TEST_CCLOUD_STATUS_COMPONENT: StatusComponent = StatusComponentFromJSON({
  id: TEST_CCLOUD_STATUS_COMPONENT_ID,
  name: TEST_CCLOUD_COMPONENT_NAME,
  status: "operational",
  created_at: Date.now().toString(),
  updated_at: Date.now().toString(),
  position: 1,
  description: "Our systems for creating and using Confluent Clusters for setting data in motion.",
  showcase: false,
  start_date: Date.now().toString(),
  group_id: null,
  page_id: TEST_CCLOUD_STATUS_PAGE_ID,
  group: false,
  only_show_if_degraded: false,
} as StatusComponent);

export const TEST_CCLOUD_INCIDENT_ID = randomUUID();

/** @see https://status.confluent.cloud/api/v2/summary.json */
export const TEST_CCLOUD_INCIDENT: Incident = IncidentFromJSON({
  created_at: Date.now().toString(),
  id: TEST_CCLOUD_INCIDENT_ID,
  impact: "major",
  incident_updates: [],
  monitoring_at: null,
  name: "TEST TEST TEST Experiencing issues with Confluent Cloud TEST TEST TEST",
  page_id: TEST_CCLOUD_STATUS_PAGE_ID,
  resolved_at: null,
  shortlink: "https://status.confluent.cloud/incidents/" + TEST_CCLOUD_INCIDENT_ID,
  status: "investigating",
  updated_at: Date.now().toString(),
} as Incident);

export const TEST_CCLOUD_SCHEDULED_MAINTENANCE_ID = randomUUID();

/** @see https://status.confluent.cloud/api/v2/summary.json */
export const TEST_CCLOUD_SCHEDULED_MAINTENANCE: ScheduledMaintenance = ScheduledMaintenanceFromJSON(
  {
    created_at: Date.now().toString(),
    id: TEST_CCLOUD_SCHEDULED_MAINTENANCE_ID,
    impact: "minor",
    incident_updates: [],
    monitoring_at: null,
    name: "TEST TEST TEST Scheduled Maintenance for Confluent Cloud TEST TEST TEST",
    page_id: TEST_CCLOUD_STATUS_PAGE_ID,
    resolved_at: null,
    scheduled_for: Date.now().toString(),
    scheduled_until: (Date.now() + 1000 * 60 * 60).toString(), // 1 hour from now
    shortlink: "https://status.confluent.cloud/incidents/" + TEST_CCLOUD_SCHEDULED_MAINTENANCE_ID,
    status: "scheduled",
    updated_at: Date.now().toString(),
  } as ScheduledMaintenance,
);

/** @see https://status.confluent.cloud/api/v2/summary.json */
export const TEST_CCLOUD_STATUS_SUMMARY: CCloudStatusSummary = CCloudStatusSummaryFromJSON({
  page: TEST_CCLOUD_STATUS_PAGE,
  components: [TEST_CCLOUD_STATUS_COMPONENT],
  incidents: [],
  scheduled_maintenances: [],
  status: {
    description: "All Systems Operational",
    indicator: "none",
  },
} as CCloudStatusSummary);
