import type { ElementKind } from "../../model";

/**
 * Эвристика kind по `technology` / `name` для форматов без явного C4 macro
 * (Structurizr). Database/Queue detection.
 *
 * Stryker disable next-line — массивы технологий статичные, проверяемые
 * через includes — мутации замены строк observationally equivalent на
 * realistic input'ах.
 */

const DATABASE_TECHS: readonly string[] = Object.freeze([
  "postgresql",
  "postgres",
  "mysql",
  "mariadb",
  "mongodb",
  "mongo",
  "redis",
  "elasticsearch",
  "dynamodb",
  "cassandra",
  "sqlite",
  "oracle",
  "sqlserver",
  "mssql",
  "clickhouse",
  "snowflake",
  "bigquery",
  "database",
  "db",
]);

const QUEUE_TECHS: readonly string[] = Object.freeze([
  "kafka",
  "rabbitmq",
  "rabbit",
  "nats",
  "sqs",
  "sns",
  "amqp",
  "activemq",
  "pulsar",
  "kinesis",
  "redpanda",
  "eventbridge",
  "servicebus",
]);

const matchesAny = (text: string, patterns: readonly string[]): boolean =>
  patterns.some((p) => text.includes(p));

/**
 * Определить kind по technology / name. Database/Queue heuristic. Defaults
 * to "Container" для unknown. Используется Structurizr loader'ом, future
 * Compose loader'ом.
 */
export const inferKindFromTechnology = (
  technology?: string,
  name?: string,
): ElementKind => {
  const techLower = technology?.toLowerCase() ?? "";
  const nameLower = name?.toLowerCase() ?? "";

  if (matchesAny(techLower, DATABASE_TECHS)) return "ContainerDb";
  if (matchesAny(techLower, QUEUE_TECHS)) return "ContainerQueue";

  // Name-based fallback — "Orders DB" / "user_db" / "events queue"
  if (
    nameLower.endsWith(" db") ||
    nameLower.endsWith("_db") ||
    nameLower.endsWith("-db") ||
    nameLower.endsWith("database")
  ) {
    return "ContainerDb";
  }
  if (
    nameLower.endsWith(" queue") ||
    nameLower.endsWith("_queue") ||
    nameLower.endsWith("-queue") ||
    nameLower.endsWith(" topic") ||
    nameLower.endsWith("_topic")
  ) {
    return "ContainerQueue";
  }

  return "Container";
};
