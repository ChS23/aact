import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadBaseline } from "../../../../src/cli/commands/diff/baseline";

const makeTempPuml = (content: string, name = "arch.puml"): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "aact-baseline-test-"));
  const file = path.join(dir, name);
  writeFileSync(file, content, "utf8");
  return file;
};

const cleanupParent = (filePath: string): void => {
  try {
    rmSync(path.dirname(filePath), { recursive: true, force: true });
  } catch {
    // benign
  }
};

const SIMPLE_PUML = `@startuml
!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml
Container(svc, "Service")
@enduml`;

describe("loadBaseline — file path inputs", () => {
  it("loads a .puml file and reports format='plantuml'", async () => {
    const file = makeTempPuml(SIMPLE_PUML);
    try {
      const result = await loadBaseline({
        arg: file,
        sideLabel: "baseline",
      });
      expect(result.side.format).toBe("plantuml");
      expect(result.side.source).toBe(file);
      expect(Object.keys(result.model.elements)).toContain("svc");
    } finally {
      cleanupParent(file);
    }
  });

  it("throws model.sourceNotFound when file does not exist", async () => {
    await expect(
      loadBaseline({ arg: "/nonexistent/file.puml", sideLabel: "baseline" }),
    ).rejects.toMatchObject({ kind: "model.sourceNotFound" });
  });

  it("throws format.unknown when extension is not recognised", async () => {
    const file = makeTempPuml("dummy", "arch.txt");
    try {
      await expect(
        loadBaseline({ arg: file, sideLabel: "baseline" }),
      ).rejects.toMatchObject({ kind: "format.unknown" });
    } finally {
      cleanupParent(file);
    }
  });

  it("honours formatOverride when extension is ambiguous", async () => {
    const file = makeTempPuml(SIMPLE_PUML, "arch.txt");
    try {
      const result = await loadBaseline({
        arg: file,
        formatOverride: "plantuml",
        sideLabel: "baseline",
      });
      expect(result.side.format).toBe("plantuml");
    } finally {
      cleanupParent(file);
    }
  });

  it("treats absolute paths containing ':' as file paths, not git refs", async () => {
    const file = makeTempPuml(SIMPLE_PUML, "arch:win.puml");
    try {
      const result = await loadBaseline({
        arg: file,
        sideLabel: "baseline",
      });
      expect(result.side.format).toBe("plantuml");
      expect(Object.keys(result.model.elements)).toContain("svc");
    } finally {
      cleanupParent(file);
    }
  });

  it("throws format.unknown for an invalid explicit format override", async () => {
    const file = makeTempPuml(SIMPLE_PUML);
    try {
      await expect(
        loadBaseline({
          arg: file,
          formatOverride: "bogus",
          sideLabel: "baseline",
        }),
      ).rejects.toMatchObject({ kind: "format.unknown" });
    } finally {
      cleanupParent(file);
    }
  });
});

describe("loadBaseline — model-json inputs", () => {
  it("accepts raw Model JSON", async () => {
    const rawModel = {
      elements: {
        svc: {
          name: "svc",
          label: "svc",
          kind: "Container",
          external: false,
          description: "",
          tags: [],
          relations: [],
        },
      },
      boundaries: {},
      rootBoundaryNames: [],
    };
    const file = makeTempPuml(JSON.stringify(rawModel), "snap.aact.json");
    try {
      const result = await loadBaseline({
        arg: file,
        sideLabel: "baseline",
      });
      expect(result.side.format).toBe("model-json");
      expect(result.model.elements.svc.name).toBe("svc");
    } finally {
      cleanupParent(file);
    }
  });

  it("accepts CliEnvelope<ModelData> shape from `aact model --json`", async () => {
    const envelope = {
      schemaVersion: 1,
      command: "model",
      ok: true,
      exitCode: 0,
      data: {
        model: {
          elements: {
            svc: {
              name: "svc",
              label: "svc",
              kind: "Container",
              external: false,
              description: "",
              tags: [],
              relations: [],
            },
          },
          boundaries: {},
          rootBoundaryNames: [],
        },
        issues: [],
      },
      diagnostics: [],
      meta: {
        aactVersion: "3.0.0-test",
        durationMs: 1,
        configPath: null,
        source: null,
      },
    };
    const file = makeTempPuml(JSON.stringify(envelope), "envelope.aact.json");
    try {
      const result = await loadBaseline({
        arg: file,
        sideLabel: "baseline",
      });
      expect(result.model.elements.svc.name).toBe("svc");
      expect(result.side.format).toBe("model-json");
    } finally {
      cleanupParent(file);
    }
  });

  it("throws model.parseError on malformed JSON", async () => {
    const file = makeTempPuml("not json {", "bad.aact.json");
    try {
      await expect(
        loadBaseline({ arg: file, sideLabel: "baseline" }),
      ).rejects.toMatchObject({ kind: "model.parseError" });
    } finally {
      cleanupParent(file);
    }
  });

  it("throws model.parseError when JSON is neither Model nor envelope", async () => {
    const file = makeTempPuml(JSON.stringify({ foo: "bar" }), "bad.aact.json");
    try {
      await expect(
        loadBaseline({ arg: file, sideLabel: "baseline" }),
      ).rejects.toMatchObject({ kind: "model.parseError" });
    } finally {
      cleanupParent(file);
    }
  });

  it("throws model.parseError when envelope.data.model is missing", async () => {
    const file = makeTempPuml(
      JSON.stringify({ data: { issues: [] } }),
      "bad.aact.json",
    );
    try {
      await expect(
        loadBaseline({ arg: file, sideLabel: "baseline" }),
      ).rejects.toMatchObject({ kind: "model.parseError" });
    } finally {
      cleanupParent(file);
    }
  });
});

// stdin tests skipped under vitest — readFileSync(0) errors out before
// reaching the format check in the test runner's pipe-less environment.
// e2e coverage exercises the stdin path via real subprocess.

describe("loadBaseline — git ref input", () => {
  it("throws model.sourceNotFound for a bogus git ref", async () => {
    await expect(
      loadBaseline({
        arg: "definitely-no-such-ref-xyz:architecture.puml",
        sideLabel: "baseline",
      }),
    ).rejects.toMatchObject({ kind: "model.sourceNotFound" });
  });

  it("loads a real git ref via scratch file when the ref exists", async () => {
    // Init a temp git repo, commit a PUML, then resolve the ref. This
    // exercises the scratch-tmp file path that the unit tests can't
    // hit without a real git working tree.
    const { execSync } = await import("node:child_process");
    const repo = mkdtempSync(path.join(tmpdir(), "aact-baseline-git-"));
    try {
      execSync("git init -q", { cwd: repo });
      execSync("git config user.email 'test@x' && git config user.name 'T'", {
        cwd: repo,
        shell: "/bin/sh",
      });
      writeFileSync(path.join(repo, "arch.puml"), SIMPLE_PUML, "utf8");
      execSync("git add arch.puml && git commit -q -m init", {
        cwd: repo,
        shell: "/bin/sh",
      });
      const result = await loadBaseline({
        arg: "HEAD:arch.puml",
        sideLabel: "baseline",
        cwd: repo,
      });
      expect(result.side.format).toBe("plantuml");
      expect(Object.keys(result.model.elements)).toContain("svc");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("loadBaseline — directory inputs (kubernetes auto-detect)", () => {
  it("infers kubernetes for a directory argument", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "aact-baseline-k8s-"));
    try {
      writeFileSync(
        path.join(dir, "deploy.yaml"),
        "apiVersion: apps/v1\nkind: Deployment\nmetadata: { name: orders }\nspec: { template: { spec: { containers: [{ image: nginx }] } } }",
        "utf8",
      );
      const result = await loadBaseline({ arg: dir, sideLabel: "baseline" });
      expect(result.side.format).toBe("kubernetes");
      expect(Object.keys(result.model.elements)).toEqual(["orders"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not collide with file detection — compose.yaml still wins over k8s", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "aact-baseline-compose-"));
    try {
      const file = path.join(dir, "compose.yaml");
      writeFileSync(file, "services:\n  api:\n    image: nginx", "utf8");
      const result = await loadBaseline({ arg: file, sideLabel: "baseline" });
      expect(result.side.format).toBe("compose");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("loadBaseline — options pass-through", () => {
  it("forwards options to format.load (skip glob applied)", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "aact-baseline-opts-"));
    try {
      writeFileSync(
        path.join(dir, "manifests.yaml"),
        [
          "apiVersion: apps/v1",
          "kind: Deployment",
          "metadata: { name: orders }",
          "spec: { template: { spec: { containers: [{ image: nginx }] } } }",
          "---",
          "apiVersion: apps/v1",
          "kind: Deployment",
          "metadata: { name: orders-canary }",
          "spec: { template: { spec: { containers: [{ image: nginx }] } } }",
        ].join("\n"),
        "utf8",
      );
      const result = await loadBaseline({
        arg: dir,
        sideLabel: "baseline",
        options: { skip: ["*-canary"] },
      });
      expect(Object.keys(result.model.elements)).toEqual(["orders"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("undefined options preserves loader defaults", async () => {
    const file = makeTempPuml(SIMPLE_PUML);
    try {
      const result = await loadBaseline({ arg: file, sideLabel: "baseline" });
      expect(Object.keys(result.model.elements)).toContain("svc");
    } finally {
      cleanupParent(file);
    }
  });
});
