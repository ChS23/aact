import type { ElementKind } from "../../model";

/**
 * Container-image → C4 ElementKind эвристика.
 *
 * Shared между всеми IaC-форматами которые ссылаются на container
 * images: Docker Compose (`image:`), Kubernetes (`spec.containers[].image`),
 * любые будущие (Nomad, Cloud Run, ECS task definitions etc.).
 *
 * Compose / k8s не имеют первоклассного способа сказать "это база
 * данных" / "это очередь" — большинство пользователей просто пишет
 * `image: postgres:13`. Мы извлекаем kind из имени образа по
 * хорошо-известным data-store / messaging keyword'ам.
 *
 * Pattern syntax (`<format>LoadOptions.imageHeuristic`):
 *   "postgres"           — exact match (vs lowercased baseName)
 *   "*postgres*"         — glob, содержит подстроку
 *   "mycompany/db-*"     — glob по полному repo path
 *
 * Heuristic консервативная — на любую неизвестную image возвращаем
 * `Container`. Юзер всегда override'ит через `aact.kind`
 * label/annotation per workload.
 */

/* ------------------------------------------------------------------ */
/*  Default image → kind map                                          */
/* ------------------------------------------------------------------ */

/**
 * Built-in pattern → ElementKind map. Покрывает majority популярных
 * data-store / messaging images на Docker Hub (по pull statistics
 * 2026). Базовые имена — parser извлекает `baseName` через last-segment
 * lowercase, так что namespace prefixes (`bitnami/postgresql`,
 * `chainguard/postgres`, `echo/redis`, `library/postgres`)
 * автоматически совпадают с этими entry'ями.
 *
 * Если default не подходит для конкретного use case (например
 * "redis как pub/sub queue") — override через user
 * `imageHeuristic: { "redis": "ContainerQueue" }`.
 */
export const DEFAULT_IMAGE_HEURISTIC: Readonly<Record<string, ElementKind>> =
  Object.freeze({
    // --- SQL relational ---
    postgres: "ContainerDb",
    postgresql: "ContainerDb",
    postgis: "ContainerDb", // PostgreSQL + GIS extension
    pgvector: "ContainerDb", // PostgreSQL + vector embeddings
    citus: "ContainerDb", // PostgreSQL sharding
    mysql: "ContainerDb",
    mariadb: "ContainerDb",
    percona: "ContainerDb",
    vitess: "ContainerDb", // MySQL sharded
    cockroachdb: "ContainerDb",
    yugabytedb: "ContainerDb",
    mssql: "ContainerDb",
    sqlserver: "ContainerDb",
    "mssql-server": "ContainerDb",
    oracle: "ContainerDb",
    "oracle-xe": "ContainerDb",
    db2: "ContainerDb",
    firebird: "ContainerDb",
    sqlite: "ContainerDb",

    // --- NoSQL document ---
    mongo: "ContainerDb",
    mongodb: "ContainerDb",
    couchdb: "ContainerDb",
    couchbase: "ContainerDb",
    rethinkdb: "ContainerDb",

    // --- KV / cache / in-memory ---
    redis: "ContainerDb",
    valkey: "ContainerDb", // Redis fork (BSD) after license change
    garnet: "ContainerDb", // Microsoft Redis-compatible
    dragonfly: "ContainerDb",
    dragonflydb: "ContainerDb",
    memcached: "ContainerDb",
    hazelcast: "ContainerDb",
    etcd: "ContainerDb", // KV store (config / coordination)

    // --- Search / analytical / OLAP ---
    elasticsearch: "ContainerDb",
    opensearch: "ContainerDb",
    elastic: "ContainerDb",
    meilisearch: "ContainerDb",
    typesense: "ContainerDb",
    solr: "ContainerDb",
    clickhouse: "ContainerDb",
    doris: "ContainerDb",
    druid: "ContainerDb",
    pinot: "ContainerDb",

    // --- Timeseries ---
    influxdb: "ContainerDb",
    timescaledb: "ContainerDb",
    questdb: "ContainerDb",
    victoriametrics: "ContainerDb",
    prometheus: "ContainerDb", // TSDB role
    graphite: "ContainerDb",

    // --- Wide-column ---
    cassandra: "ContainerDb",
    scylladb: "ContainerDb",

    // --- Graph ---
    neo4j: "ContainerDb",
    dgraph: "ContainerDb",
    arangodb: "ContainerDb",
    janusgraph: "ContainerDb",

    // --- Vector DBs (AI-era) ---
    qdrant: "ContainerDb",
    milvus: "ContainerDb",
    weaviate: "ContainerDb",
    chroma: "ContainerDb",
    chromadb: "ContainerDb",

    // --- Object / blob ---
    minio: "ContainerDb",
    seaweedfs: "ContainerDb",

    // --- Streaming / pub-sub queues ---
    kafka: "ContainerQueue",
    redpanda: "ContainerQueue",
    warpstream: "ContainerQueue", // Kafka-compatible serverless
    pulsar: "ContainerQueue",

    // --- Classic message brokers ---
    rabbitmq: "ContainerQueue",
    activemq: "ContainerQueue",
    artemis: "ContainerQueue", // ActiveMQ Artemis
    nats: "ContainerQueue",
    jetstream: "ContainerQueue",
    nsq: "ContainerQueue",

    // --- MQTT brokers ---
    mosquitto: "ContainerQueue",
    emqx: "ContainerQueue",

    // --- Event sourcing ---
    eventstore: "ContainerDb",
    eventstoredb: "ContainerDb",
  });

/* ------------------------------------------------------------------ */
/*  Pattern compilation + matching                                    */
/* ------------------------------------------------------------------ */

/** Compiled pattern entry: exact match или glob с regex. */
export interface CompiledPattern {
  readonly pattern: string;
  readonly kind: ElementKind;
  /** undefined для exact-match; иначе regex обёрнутый из glob. */
  readonly regex?: RegExp;
}

const escapeRegex = (input: string): string =>
  input.replaceAll(/[.+?^${}()|[\]\\]/g, String.raw`\$&`);

const compilePattern = (
  pattern: string,
  kind: ElementKind,
): CompiledPattern => {
  if (!pattern.includes("*")) {
    return Object.freeze({ pattern, kind });
  }
  const regexSrc = `^${pattern
    .split("*")
    .map((segment) => escapeRegex(segment))
    .join(".*")}$`;
  return Object.freeze({
    pattern,
    kind,
    regex: new RegExp(regexSrc),
  });
};

/**
 * Объединяет user patterns с defaults. User patterns идут ПЕРВЫМИ —
 * first-match-wins даёт пользователю явный override без необходимости
 * явно отключать default. Defaults в фиксированном порядке (insertion).
 */
export const compileImageHeuristic = (
  userPatterns?: Readonly<Record<string, ElementKind>>,
): readonly CompiledPattern[] => {
  const userEntries = Object.entries(userPatterns ?? {});
  const userPatternSet = new Set(userEntries.map(([p]) => p));
  // Default entries которые не переопределены — добавляются после
  // user-entries. Если pattern есть и в user, и в defaults — берётся
  // user-версия.
  const defaultEntries = Object.entries(DEFAULT_IMAGE_HEURISTIC).filter(
    ([pattern]) => !userPatternSet.has(pattern),
  );
  const all: CompiledPattern[] = [
    ...userEntries.map(([pattern, kind]) => compilePattern(pattern, kind)),
    ...defaultEntries.map(([pattern, kind]) => compilePattern(pattern, kind)),
  ];
  return Object.freeze(all);
};

const matchesPattern = (
  baseName: string,
  repoPath: string,
  entry: CompiledPattern,
): boolean => {
  // Pattern с `/` матчится против полного repo path; без `/` — против
  // lowercased baseName.
  const target = entry.pattern.includes("/") ? repoPath : baseName;
  if (entry.regex) return entry.regex.test(target);
  return target === entry.pattern;
};

/**
 * Resolve ElementKind по compiled patterns. Возвращает первый match
 * (user override приоритетнее defaults). Fallback — `Container`.
 */
export const inferKindFromImage = (
  baseName: string,
  repoPath: string,
  compiled: readonly CompiledPattern[],
): ElementKind => {
  if (baseName.length === 0) return "Container";
  for (const entry of compiled) {
    if (matchesPattern(baseName, repoPath, entry)) return entry.kind;
  }
  return "Container";
};

/**
 * Glob pattern matcher для skip / других name-based filter'ов.
 * Шарит ту же `*` семантику что и imageHeuristic.
 */
export const matchesGlob = (input: string, pattern: string): boolean => {
  if (!pattern.includes("*")) return input === pattern;
  const regex = new RegExp(
    `^${pattern
      .split("*")
      .map((segment) => escapeRegex(segment))
      .join(".*")}$`,
  );
  return regex.test(input);
};

/* ------------------------------------------------------------------ */
/*  Image string parsing                                              */
/* ------------------------------------------------------------------ */

/**
 * Image string normalization для kind heuristic + technology label.
 *
 * Compose `image:` / k8s `spec.containers[].image` принимают любой
 * ref Docker Image Spec'а:
 *   postgres                                     # repo
 *   postgres:13                                  # repo:tag
 *   docker.io/library/postgres:13                # registry/library/repo:tag
 *   ghcr.io/org/repo:v1@sha256:abcdef...         # registry/repo:tag@digest
 *   ${POSTGRES_IMAGE:-postgres:13}               # env-var interpolation (compose only)
 *
 * Для kind heuristic нам нужен только `repo` (`postgres`, `rabbitmq`...).
 * Для technology label — короткая форма без digest, чтобы не показывать
 * `postgres:13@sha256:abc...` пользователю.
 */

export interface ParsedImage {
  /** Полный original string как в манифесте. */
  readonly raw: string;
  /** Registry часть (`docker.io` / `ghcr.io` / ...) — пустая если
   *  не указана. Не путать с library namespace (`library/`). */
  readonly registry: string;
  /** Repo path без registry и без tag/digest: `library/postgres`
   *  → `library/postgres`; `postgres` → `postgres`. */
  readonly repo: string;
  /** Базовое имя репо (last segment): `library/postgres` →
   *  `postgres`. По нему делается kind heuristic. */
  readonly baseName: string;
  /** Tag без digest: `13`, `latest`, `v1`. Пустой если не указан. */
  readonly tag: string;
  /** Digest part (после `@`). Пустой если не указан. */
  readonly digest: string;
}

const ENV_VAR_RE = /^\$\{([A-Z0-9_]+)(?::-([^}]*))?\}$/i;

/**
 * Развёрнутая обработка env-var interpolation (compose-specific
 * нотация, но безвредна для k8s — там просто not-match):
 *   `${POSTGRES_IMAGE:-postgres:13}` → `postgres:13`
 *   `${POSTGRES_IMAGE}`              → `postgres_image` (lowercased
 *                                       var name fallback)
 */
const expandEnvVar = (input: string): string => {
  const m = ENV_VAR_RE.exec(input.trim());
  if (!m) return input;
  const [, varName, defaultValue] = m;
  if (defaultValue && defaultValue.length > 0) return defaultValue;
  return (varName ?? "").toLowerCase();
};

const KNOWN_REGISTRY_HOSTS: readonly string[] = Object.freeze([
  "docker.io",
  "ghcr.io",
  "gcr.io",
  "quay.io",
  "registry.k8s.io",
  "mcr.microsoft.com",
  "public.ecr.aws",
]);

const hasRegistryPrefix = (firstSegment: string): boolean => {
  // Registry host эвристика: содержит точку ИЛИ номер порта
  // (`localhost:5000`) ИЛИ матчит известный registry. Согласуется с
  // Docker distribution-spec — `library/postgres` НЕ registry,
  // `docker.io` ИСЛЕ.
  if (KNOWN_REGISTRY_HOSTS.includes(firstSegment)) return true;
  if (firstSegment.includes(".") || firstSegment.includes(":")) return true;
  return false;
};

/**
 * Парсит image ref в структурированную форму. Безопасна на любом
 * input'е (env-var interp, malformed strings) — никогда не бросает.
 */
export const parseImage = (input: string): ParsedImage => {
  const expanded = expandEnvVar(input);
  const raw = input;

  // Split digest (`@sha256:...`) сначала — `@` гарантированно
  // делит ref на (repo:tag, digest).
  const [refOnly, digestPart] = expanded.split("@", 2);
  const digest = digestPart ?? "";

  // Split tag (`:13`). Но `:` в registry-host (`localhost:5000`) —
  // ложный split. Считаем что после ПОСЛЕДНЕГО `/` всё что после
  // `:` — tag.
  const lastSlash = (refOnly ?? "").lastIndexOf("/");
  const head = lastSlash === -1 ? "" : refOnly.slice(0, lastSlash);
  const tail =
    lastSlash === -1 ? (refOnly ?? "") : refOnly.slice(lastSlash + 1);
  const tagSplit = tail.indexOf(":");
  const repoLast = tagSplit === -1 ? tail : tail.slice(0, tagSplit);
  const tag = tagSplit === -1 ? "" : tail.slice(tagSplit + 1);

  // Registry: head может содержать registry-host как первый segment.
  let registry = "";
  let repoPath = head;
  if (head.length > 0) {
    const firstSlash = head.indexOf("/");
    const firstSeg = firstSlash === -1 ? head : head.slice(0, firstSlash);
    if (hasRegistryPrefix(firstSeg)) {
      registry = firstSeg;
      repoPath = firstSlash === -1 ? "" : head.slice(firstSlash + 1);
    }
  }

  const repo = repoPath.length > 0 ? `${repoPath}/${repoLast}` : repoLast;
  const baseName = repoLast.toLowerCase();

  return Object.freeze({
    raw,
    registry,
    repo,
    baseName,
    tag,
    digest,
  });
};

/**
 * Human-friendly technology string без digest:
 *   `postgres:13` → `postgres:13`
 *   `docker.io/library/postgres:13@sha256:abc...` → `postgres:13`
 *   `ghcr.io/org/repo:v1` → `ghcr.io/org/repo:v1`
 *   image with build only → ""
 */
export const technologyLabel = (parsed: ParsedImage): string => {
  if (parsed.repo.length === 0) return "";
  const base =
    parsed.registry.length > 0
      ? `${parsed.registry}/${parsed.repo}`
      : // Strip `library/` prefix — это Docker Hub соглашение для
        // официальных образов; не информативно для пользователя.
        parsed.repo.replace(/^library\//, "");
  return parsed.tag.length > 0 ? `${base}:${parsed.tag}` : base;
};
