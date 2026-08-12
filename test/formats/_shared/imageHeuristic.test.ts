import {
  compileImageHeuristic,
  DEFAULT_IMAGE_HEURISTIC,
  inferKindFromImage,
  matchesGlob,
} from "../../../src/formats/_shared/imageHeuristic";

describe("DEFAULT_IMAGE_HEURISTIC", () => {
  it("classifies SQL stores as ContainerDb", () => {
    expect(DEFAULT_IMAGE_HEURISTIC.postgres).toBe("ContainerDb");
    expect(DEFAULT_IMAGE_HEURISTIC.mysql).toBe("ContainerDb");
    expect(DEFAULT_IMAGE_HEURISTIC.mongo).toBe("ContainerDb");
  });

  it("classifies KV / cache stores as ContainerDb", () => {
    expect(DEFAULT_IMAGE_HEURISTIC.redis).toBe("ContainerDb");
    expect(DEFAULT_IMAGE_HEURISTIC.memcached).toBe("ContainerDb");
  });

  it("classifies vector DBs as ContainerDb", () => {
    expect(DEFAULT_IMAGE_HEURISTIC.qdrant).toBe("ContainerDb");
    expect(DEFAULT_IMAGE_HEURISTIC.milvus).toBe("ContainerDb");
  });

  it("classifies streaming/MQ brokers as ContainerQueue", () => {
    expect(DEFAULT_IMAGE_HEURISTIC.kafka).toBe("ContainerQueue");
    expect(DEFAULT_IMAGE_HEURISTIC.rabbitmq).toBe("ContainerQueue");
    expect(DEFAULT_IMAGE_HEURISTIC.nats).toBe("ContainerQueue");
  });

  it("is frozen (insertion order matters)", () => {
    expect(Object.isFrozen(DEFAULT_IMAGE_HEURISTIC)).toBe(true);
  });
});

describe("compileImageHeuristic", () => {
  it("returns defaults unchanged when no user patterns", () => {
    const compiled = compileImageHeuristic();
    const postgresEntry = compiled.find((c) => c.pattern === "postgres");
    expect(postgresEntry?.kind).toBe("ContainerDb");
  });

  it("works with empty user object", () => {
    const compiled = compileImageHeuristic({});
    const kafkaEntry = compiled.find((c) => c.pattern === "kafka");
    expect(kafkaEntry?.kind).toBe("ContainerQueue");
  });

  it("user patterns come first (first-match-wins ordering)", () => {
    const compiled = compileImageHeuristic({
      "my-custom-store": "ContainerDb",
    });
    expect(compiled[0].pattern).toBe("my-custom-store");
  });

  it("user override beats matching default", () => {
    // User reclassifies `redis` as a queue rather than a KV store.
    const compiled = compileImageHeuristic({ redis: "ContainerQueue" });
    const redisHits = compiled.filter((c) => c.pattern === "redis");
    expect(redisHits).toHaveLength(1);
    expect(redisHits[0].kind).toBe("ContainerQueue");
  });

  it("glob pattern (with *) compiles to a regex", () => {
    const compiled = compileImageHeuristic({ "*custom*": "ContainerDb" });
    const entry = compiled.find((c) => c.pattern === "*custom*");
    expect(entry?.regex).toBeInstanceOf(RegExp);
    expect(entry?.regex?.test("my-custom-store")).toBe(true);
  });

  it("exact pattern (no *) has no compiled regex", () => {
    const compiled = compileImageHeuristic({ exact: "ContainerDb" });
    const entry = compiled.find((c) => c.pattern === "exact");
    expect(entry?.regex).toBeUndefined();
  });
});

describe("inferKindFromImage", () => {
  const compiled = compileImageHeuristic();

  it("returns Container for empty baseName", () => {
    expect(inferKindFromImage("", "", compiled)).toBe("Container");
  });

  it("matches postgres → ContainerDb on baseName", () => {
    expect(inferKindFromImage("postgres", "postgres", compiled)).toBe(
      "ContainerDb",
    );
  });

  it("matches kafka → ContainerQueue on baseName", () => {
    expect(inferKindFromImage("kafka", "bitnami/kafka", compiled)).toBe(
      "ContainerQueue",
    );
  });

  it("unknown baseName → Container fallback", () => {
    expect(inferKindFromImage("nginx", "nginx", compiled)).toBe("Container");
  });

  it("matches pattern with `/` against repoPath, not baseName", () => {
    const customCompiled = compileImageHeuristic({
      "mycompany/db-*": "ContainerDb",
    });
    // repoPath matches `mycompany/db-*`, baseName alone wouldn't have.
    expect(
      inferKindFromImage("orders", "mycompany/db-orders", customCompiled),
    ).toBe("ContainerDb");
    // Different repo → no match → fallback.
    expect(
      inferKindFromImage("orders", "other/db-orders", customCompiled),
    ).toBe("Container");
  });

  it("matches *substring* glob on baseName", () => {
    const customCompiled = compileImageHeuristic({
      "*postgres*": "ContainerDb",
    });
    expect(
      inferKindFromImage("custompostgres", "custompostgres", customCompiled),
    ).toBe("ContainerDb");
    // Non-matching baseName falls through to defaults / Container.
    expect(inferKindFromImage("nginx", "nginx", customCompiled)).toBe(
      "Container",
    );
  });

  it("first-match-wins (user pattern beats default)", () => {
    const customCompiled = compileImageHeuristic({
      postgres: "Container",
    });
    expect(inferKindFromImage("postgres", "postgres", customCompiled)).toBe(
      "Container",
    );
  });
});

describe("matchesGlob", () => {
  it("exact match without *", () => {
    expect(matchesGlob("nginx", "nginx")).toBe(true);
    expect(matchesGlob("nginx", "redis")).toBe(false);
  });

  it("trailing * matches prefix", () => {
    expect(matchesGlob("cypress-tests", "cypress-*")).toBe(true);
    expect(matchesGlob("cypress", "cypress-*")).toBe(false);
  });

  it("leading * matches suffix", () => {
    expect(matchesGlob("auth-svc", "*-svc")).toBe(true);
    expect(matchesGlob("auth", "*-svc")).toBe(false);
  });

  it("`*foo*` matches substring", () => {
    expect(matchesGlob("my-postgres-db", "*postgres*")).toBe(true);
    expect(matchesGlob("mysql", "*postgres*")).toBe(false);
  });

  it("multiple stars compose into greedy regex", () => {
    expect(matchesGlob("mycompany/db-orders", "mycompany/db-*")).toBe(true);
    expect(matchesGlob("mycompany/svc", "mycompany/db-*")).toBe(false);
  });

  it("escapes regex metachars in literal segments", () => {
    // `+` in the pattern should be treated as a literal, not a regex
    // quantifier (so `a+b` matches only `a+b`, not `aab`).
    expect(matchesGlob("a+b", "a+b")).toBe(true);
    expect(matchesGlob("aab", "a+b")).toBe(false);
  });
});
