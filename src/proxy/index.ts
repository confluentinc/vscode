/**
 * Proxy module for Confluent service API calls.
 *
 * Provides HTTP clients and proxies for:
 * - Kafka REST API v3
 * - Schema Registry API
 * - CCloud Control Plane API
 * - CCloud Data Plane API (Flink)
 */

// HTTP Client
export {
  createHttpClient,
  HttpClient,
  HttpError,
  TimeoutError,
  type AuthConfig,
  type AuthType,
  type HttpClientConfig,
  type HttpMethod,
  type HttpResponse,
  type RequestOptions,
} from "./httpClient";
