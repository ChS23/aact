import { tmpdir } from "node:os";
import path from "node:path";

import { parseDocument } from "yaml";

import type { IncludedFile } from "../../../src/formats/compose/include";
import { toModel } from "../../../src/formats/compose/toModel";
import type {
  ComposeLoadOptions,
  ParsedComposeFile,
} from "../../../src/formats/compose/types";

// `toModel` is pure — entryFile is only used to derive a workspace-name
// fallback (parent dir) and to attach to SourceLocation. We never touch
// the filesystem here, so virtual paths under tmpdir() are fine and
// keep sonarjs's publicly-writable-directories rule happy.
const VIRTUAL_DIR = path.join(tmpdir(), "aact-test");
const DEFAULT_ENTRY = path.join(VIRTUAL_DIR, "compose.yml");
const WORKSPACE_ENTRY = path.join(tmpdir(), "aact-workspace", "compose.yml");
const BASE_ENTRY = path.join(VIRTUAL_DIR, "base.yml");

const makeIncluded = (file: string, source: string): IncludedFile => {
  const documentFactory = () =>
    parseDocument(source, { keepSourceTokens: true });
  const doc = documentFactory();
  const parsed = (doc.toJSON() ?? {}) as ParsedComposeFile;
  return Object.freeze({
    file,
    source,
    parsed,
    documentFactory,
  });
};

const runToModel = (
  source: string,
  options?: ComposeLoadOptions,
  entryFile = DEFAULT_ENTRY,
) => {
  const file = makeIncluded(entryFile, source);
  return toModel({ entryFile, files: [file], options });
};

describe("toModel — service classification", () => {
  it("emits Container for plain image service", () => {
    const { model } = runToModel("services:\n  api:\n    image: nginx\n");
    expect(model.elements.api).toBeDefined();
    expect(model.elements.api.kind).toBe("Container");
    expect(model.elements.api.external).toBe(false);
  });

  it("infers ContainerDb from `image: postgres:13`", () => {
    const { model } = runToModel("services:\n  db:\n    image: postgres:13\n");
    expect(model.elements.db.kind).toBe("ContainerDb");
    expect(model.elements.db.technology).toBe("postgres:13");
  });

  it("infers ContainerQueue from `image: rabbitmq`", () => {
    const { model } = runToModel("services:\n  bus:\n    image: rabbitmq\n");
    expect(model.elements.bus.kind).toBe("ContainerQueue");
  });

  it("emits Container when service has only `build` (no image)", () => {
    const { model } = runToModel("services:\n  api:\n    build: .\n");
    expect(model.elements.api.kind).toBe("Container");
    expect(model.elements.api.technology).toBeUndefined();
  });

  it("emits warning when neither image nor build is present", () => {
    const { issues } = runToModel("services:\n  api:\n    container_name: x\n");
    expect(
      issues.some(
        (i) =>
          i.kind === "loader-warning" &&
          "code" in i &&
          i.code === "no-image-or-build",
      ),
    ).toBe(true);
  });
});

describe("toModel — labels and overrides", () => {
  it("aact.kind label overrides image-based inference", () => {
    const { model } = runToModel(
      `services:
  store:
    image: nginx
    labels:
      aact.kind: ContainerDb
`,
    );
    expect(model.elements.store.kind).toBe("ContainerDb");
  });

  it("aact.element label overrides naming transform", () => {
    const { model } = runToModel(
      `services:
  raw-name:
    image: nginx
    labels:
      aact.element: customName
`,
    );
    expect(model.elements.customName).toBeDefined();
    expect(model.elements["raw-name"]).toBeUndefined();
  });

  it("aact.label sets human label", () => {
    const { model } = runToModel(
      `services:
  api:
    image: nginx
    labels:
      aact.label: "Public API"
`,
    );
    expect(model.elements.api.label).toBe("Public API");
  });

  it("aact.label defaults to humanize(name) when missing", () => {
    const { model } = runToModel(
      `services:
  api-gateway:
    image: nginx
`,
    );
    expect(model.elements["api-gateway"].label).toBe("API Gateway");
  });

  it("aact.description sets description", () => {
    const { model } = runToModel(
      `services:
  api:
    image: nginx
    labels:
      aact.description: Public REST API
`,
    );
    expect(model.elements.api.description).toBe("Public REST API");
  });

  it("aact.tags parses CSV string into tags array", () => {
    const { model } = runToModel(
      `services:
  api:
    image: nginx
    labels:
      aact.tags: public,tier-1
`,
    );
    expect([...model.elements.api.tags].toSorted()).toEqual([
      "public",
      "tier-1",
    ]);
  });

  it("aact.external=true marks element as external", () => {
    const { model } = runToModel(
      `services:
  stripe:
    image: nginx
    labels:
      aact.external: "true"
`,
    );
    expect(model.elements.stripe.external).toBe(true);
  });

  it("aact.external=1 also marks as external", () => {
    const { model } = runToModel(
      `services:
  stripe:
    image: nginx
    labels:
      aact.external: "1"
`,
    );
    expect(model.elements.stripe.external).toBe(true);
  });

  it("aact.link adds clickable link", () => {
    const { model } = runToModel(
      `services:
  api:
    image: nginx
    labels:
      aact.link: https://docs.example.com
`,
    );
    expect(model.elements.api.link).toBe("https://docs.example.com");
  });

  it("aact.technology overrides image-derived technology", () => {
    const { model } = runToModel(
      `services:
  api:
    image: nginx
    labels:
      aact.technology: "Custom Stack"
`,
    );
    expect(model.elements.api.technology).toBe("Custom Stack");
  });

  it("custom label prefix is honored", () => {
    const { model } = runToModel(
      `services:
  api:
    image: nginx
    labels:
      arch.kind: ContainerDb
`,
      { labels: { prefix: "arch" } },
    );
    expect(model.elements.api.kind).toBe("ContainerDb");
  });

  it("malformed list-form label emits loader-warning", () => {
    const { issues } = runToModel(
      `services:
  api:
    image: nginx
    labels:
      - 42
`,
    );
    expect(
      issues.some(
        (i) =>
          i.kind === "loader-warning" &&
          "code" in i &&
          i.code === "malformed-label",
      ),
    ).toBe(true);
  });
});

describe("toModel — skip patterns", () => {
  it("config-level skip glob excludes service", () => {
    const { model } = runToModel(
      `services:
  api:
    image: nginx
  cypress-runner:
    image: cypress/included
`,
      { skip: ["cypress-*"] },
    );
    expect(model.elements.api).toBeDefined();
    expect(model.elements["cypress-runner"]).toBeUndefined();
  });

  it("aact.skip=true on service excludes it", () => {
    const { model } = runToModel(
      `services:
  api:
    image: nginx
  adminer:
    image: adminer
    labels:
      aact.skip: "true"
`,
    );
    expect(model.elements.adminer).toBeUndefined();
  });

  it("aact.skip=1 also excludes service", () => {
    const { model } = runToModel(
      `services:
  adminer:
    image: adminer
    labels:
      aact.skip: "1"
`,
    );
    expect(model.elements.adminer).toBeUndefined();
  });
});

describe("toModel — depends_on relations", () => {
  it("short-form depends_on emits relations", () => {
    const { model } = runToModel(
      `services:
  api:
    image: nginx
    depends_on:
      - db
  db:
    image: postgres
`,
    );
    expect(model.elements.api.relations.map((r) => r.to)).toEqual(["db"]);
  });

  it("long-form depends_on emits relations (keys only)", () => {
    const { model } = runToModel(
      `services:
  api:
    image: nginx
    depends_on:
      db:
        condition: service_healthy
  db:
    image: postgres
`,
    );
    expect(model.elements.api.relations.map((r) => r.to)).toEqual(["db"]);
  });

  it("relation gets source location (long-form depends_on)", () => {
    // Long form (map) is what `valueLocationFor` can address by key —
    // short-form arrays don't carry per-target key positions.
    const { model } = runToModel(
      `services:
  api:
    image: nginx
    depends_on:
      db:
        condition: service_started
  db:
    image: postgres
`,
    );
    expect(model.elements.api.relations[0].sourceLocation).toBeDefined();
  });

  it("naming transform applies to depends_on targets too", () => {
    const { model } = runToModel(
      `services:
  api-svc:
    image: nginx
    depends_on:
      - db-store
  db-store:
    image: postgres
`,
      { naming: "kebab-to-camel" },
    );
    expect(model.elements.apiSvc.relations.map((r) => r.to)).toEqual([
      "dbStore",
    ]);
  });
});

describe("toModel — naming transform", () => {
  it("kebab-to-camel preset renames services", () => {
    const { model } = runToModel(
      "services:\n  landing-app:\n    image: nginx\n",
      { naming: "kebab-to-camel" },
    );
    expect(model.elements.landingApp).toBeDefined();
    expect(model.elements["landing-app"]).toBeUndefined();
  });

  it("as-is preserves raw name", () => {
    const { model } = runToModel(
      "services:\n  landing-app:\n    image: nginx\n",
      { naming: "as-is" },
    );
    expect(model.elements["landing-app"]).toBeDefined();
  });
});

describe("toModel — provider services", () => {
  it("provider service becomes external System", () => {
    const { model } = runToModel(
      `services:
  openai:
    provider:
      type: model
      options:
        endpoint: https://api.openai.com
`,
    );
    const el = model.elements.openai;
    expect(el).toBeDefined();
    expect(el.kind).toBe("System");
    expect(el.external).toBe(true);
    expect(el.technology).toBe("model");
    expect([...el.tags]).toContain("provider");
  });

  it("provider service honors aact.tags label", () => {
    const { model } = runToModel(
      `services:
  openai:
    provider:
      type: model
    labels:
      aact.tags: "llm,external"
`,
    );
    const tags = [...model.elements.openai.tags].toSorted();
    expect(tags).toContain("provider");
    expect(tags).toContain("llm");
    expect(tags).toContain("external");
  });
});

describe("toModel — AI models", () => {
  it("top-level models block emits external System per model", () => {
    const { model } = runToModel(
      `services:
  api:
    image: nginx
    models:
      - llama3
models:
  llama3:
    model: ai/llama3.2
`,
    );
    expect(model.elements.llama3).toBeDefined();
    expect(model.elements.llama3.kind).toBe("System");
    expect(model.elements.llama3.external).toBe(true);
    expect(model.elements.llama3.technology).toBe("AI model");
    expect(model.elements.llama3.description).toBe("ai/llama3.2");
  });

  it("service `models:` reference emits relation to the model element", () => {
    const { model } = runToModel(
      `services:
  api:
    image: nginx
    models:
      - llama3
models:
  llama3:
    model: ai/llama3.2
`,
    );
    expect(model.elements.api.relations.map((r) => r.to)).toContain("llama3");
  });

  it("AI-model relation description is configurable", () => {
    const { model } = runToModel(
      `services:
  api:
    image: nginx
    models:
      - llama3
models:
  llama3:
    model: ai/llama3.2
`,
      { models: { relationDescription: "invokes" } },
    );
    const rel = model.elements.api.relations.find((r) => r.to === "llama3");
    expect(rel?.description).toBe("invokes");
  });
});

describe("toModel — workspace + edge cases", () => {
  it("uses compose `name:` as workspace name", () => {
    const { model } = runToModel(
      "name: my-app\nservices:\n  api:\n    image: nginx\n",
    );
    expect(model.workspace?.name).toBe("my-app");
  });

  it("falls back to parent dir name when no `name:` is set", () => {
    const { model } = runToModel(
      "services:\n  api:\n    image: nginx\n",
      undefined,
      WORKSPACE_ENTRY,
    );
    expect(model.workspace?.name).toBe("aact-workspace");
  });

  it("`version:` top-level emits obsolete warning", () => {
    const { issues } = runToModel(
      "version: '3.8'\nservices:\n  api:\n    image: nginx\n",
    );
    expect(
      issues.some(
        (i) =>
          i.kind === "loader-warning" &&
          "code" in i &&
          i.code === "version-obsolete",
      ),
    ).toBe(true);
  });

  it("`extends` emits unsupported warning", () => {
    const { issues } = runToModel(
      `services:
  api:
    image: nginx
    extends:
      service: base
`,
    );
    expect(
      issues.some(
        (i) =>
          i.kind === "loader-warning" &&
          "code" in i &&
          i.code === "extends-unsupported",
      ),
    ).toBe(true);
  });

  it("merges multiple files (last-write-wins on service collision)", () => {
    const earlier = makeIncluded(
      BASE_ENTRY,
      "services:\n  api:\n    image: nginx\n",
    );
    const later = makeIncluded(
      DEFAULT_ENTRY,
      "services:\n  api:\n    image: nginx:alpine\n",
    );
    const result = toModel({
      entryFile: DEFAULT_ENTRY,
      files: [earlier, later],
      options: undefined,
    });
    expect(result.model.elements.api.technology).toBe("nginx:alpine");
  });

  it("attaches sourceLocation to service element", () => {
    const { model } = runToModel("services:\n  api:\n    image: nginx\n");
    expect(model.elements.api.sourceLocation).toBeDefined();
    expect(model.elements.api.sourceLocation?.file).toBe(DEFAULT_ENTRY);
  });
});
