/** Similar to {@link ConnectionType}, but only used for telemetry purposes. */
export type FormConnectionType =
  | "Apache Kafka"
  | "Confluent Cloud"
  | "Confluent Platform"
  | "WarpStream"
  | "Other";

export type SupportedAuthTypes = "None" | "Basic" | "API" | "SCRAM" | "OAuth" | "Kerberos";
