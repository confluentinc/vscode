export interface StatusPage {
  id: string;
  name: string;
  url: string;
  time_zone: string;
  updated_at: string;
}

export function StatusPageFromJSON(obj: any): StatusPage {
  return {
    id: obj.id,
    name: obj.name,
    url: obj.url,
    time_zone: obj.time_zone,
    updated_at: obj.updated_at,
  };
}

export interface StatusComponent {
  id: string;
  name: string;
  status: string;
  created_at: string;
  updated_at: string;
  position: number;
  description: string;
  showcase: boolean;
  start_date: string;
  group_id: string | null;
  page_id: string;
  group: boolean;
  only_show_if_degraded: boolean;
}

export function StatusComponentFromJSON(obj: any): StatusComponent {
  return {
    id: obj.id,
    name: obj.name,
    status: obj.status,
    created_at: obj.created_at,
    updated_at: obj.updated_at,
    position: obj.position,
    description: obj.description,
    showcase: obj.showcase,
    start_date: obj.start_date,
    group_id: obj.group_id,
    page_id: obj.page_id,
    group: obj.group,
    only_show_if_degraded: obj.only_show_if_degraded,
  };
}

export interface StatusUpdate {
  body: string;
  created_at: string;
  display_at: string;
  id: string;
  incident_id: string;
  status: string;
  updated_at: string;
}

export function StatusUpdateFromJSON(obj: any): StatusUpdate {
  return {
    body: obj.body,
    created_at: obj.created_at,
    display_at: obj.display_at,
    id: obj.id,
    incident_id: obj.incident_id,
    status: obj.status,
    updated_at: obj.updated_at,
  };
}

export type Impact = "none" | "minor" | "major" | "critical";

/** A Statuspage incident. @see https://metastatuspage.com/api#incidents */
export interface Incident {
  created_at: string;
  id: string;
  impact: Impact;
  incident_updates: StatusUpdate[];
  monitoring_at: string | null;
  name: string;
  page_id: string;
  resolved_at: string | null;
  shortlink: string;
  status: string; // investigating, identified, monitoring, resolved, postmortem
  updated_at: string;
}

/** Converts a JSON object to an {@link Incident} object. */
export function IncidentFromJSON(obj: any): Incident {
  return {
    created_at: obj.created_at,
    id: obj.id,
    impact: obj.impact,
    incident_updates: obj.incident_updates.map((update: any) => StatusUpdateFromJSON(update)),
    monitoring_at: obj.monitoring_at,
    name: obj.name,
    page_id: obj.page_id,
    resolved_at: obj.resolved_at,
    shortlink: obj.shortlink,
    status: obj.status,
    updated_at: obj.updated_at,
  };
}

export interface ScheduledMaintenance {
  created_at: string;
  id: string;
  impact: Impact;
  incident_updates: StatusUpdate[];
  monitoring_at: string | null;
  name: string;
  page_id: string;
  resolved_at: string | null;
  scheduled_for: string;
  scheduled_until: string | null;
  shortlink: string;
  status: string; // scheduled, in progress, verifying, completed
  updated_at: string;
}

export function ScheduledMaintenanceFromJSON(obj: any): ScheduledMaintenance {
  return {
    created_at: obj.created_at,
    id: obj.id,
    impact: obj.impact,
    incident_updates: obj.incident_updates.map((update: any) => StatusUpdateFromJSON(update)),
    monitoring_at: obj.monitoring_at,
    name: obj.name,
    page_id: obj.page_id,
    resolved_at: obj.resolved_at,
    scheduled_for: obj.scheduled_for,
    scheduled_until: obj.scheduled_until,
    shortlink: obj.shortlink,
    status: obj.status,
    updated_at: obj.updated_at,
  };
}

export interface CCloudStatus {
  page: StatusPage;
  components: StatusComponent[];
  incidents: Incident[];
  scheduled_maintenances: ScheduledMaintenance[];
  status: {
    description: string;
    indicator: string;
  };
}

export function CCloudStatusFromJSON(obj: any): CCloudStatus {
  return {
    page: StatusPageFromJSON(obj.page),
    components: obj.components.map((component: any) => StatusComponentFromJSON(component)),
    incidents: obj.incidents.map((incident: any) => IncidentFromJSON(incident)),
    scheduled_maintenances: obj.scheduled_maintenances.map((maintenance: any) =>
      ScheduledMaintenanceFromJSON(maintenance),
    ),
    status: {
      description: obj.status.description,
      indicator: obj.status.indicator,
    },
  };
}
