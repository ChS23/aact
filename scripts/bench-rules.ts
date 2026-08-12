// Standalone perf bench. Run: pnpm exec jiti scripts/bench-rules.ts
// Goal: measure analyze + each builtin rule on synthetic + real fixtures.

import path from "node:path";
import { performance } from "node:perf_hooks";
import url from "node:url";

import type { Boundary, Element, Model, RuleDefinition } from "../src/index";
import {
  aclRule,
  acyclicRule,
  analyzeArchitecture,
  apiGatewayRule,
  buildModel,
  canLoad,
  cohesionRule,
  commonReuseRule,
  crudRule,
  dbPerServiceRule,
  loadFormat,
  stableDependenciesRule,
} from "../src/index";

const RULES: ReadonlyArray<{ name: string; rule: RuleDefinition }> = [
  { name: "acyclic", rule: acyclicRule },
  { name: "cohesion", rule: cohesionRule },
  { name: "commonReuse", rule: commonReuseRule },
  { name: "crud", rule: crudRule },
  { name: "dbPerService", rule: dbPerServiceRule },
  { name: "stableDependencies", rule: stableDependenciesRule },
  { name: "acl", rule: aclRule },
  { name: "apiGateway", rule: apiGatewayRule },
];

const N_RUNS = 7;

const measure = (label: string, fn: () => void): number => {
  // Warm
  fn();
  const samples: number[] = [];
  for (let i = 0; i < N_RUNS; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
};

// ---- Synthetic generator ----
// Layout: B parent boundaries, each containing services + 1 db + cross-deps.
// services-per-boundary mix: 1 repo, k callers; each caller -> repo (cohesion),
// some -> next boundary's repo (cross-boundary), some -> own db.
const synth = (B: number, perB: number): Model => {
  const containers: Element[] = [];
  const boundaries: Boundary[] = [];
  const root: string[] = [];

  for (let b = 0; b < B; b++) {
    const elementNames: string[] = [];
    const repo = `b${b}_repo`;
    const db = `b${b}_db`;
    elementNames.push(repo, db);
    containers.push(
      {
        name: repo,
        label: repo,
        kind: "Container",
        external: false,
        description: "",
        tags: ["repo"],
        relations: [{ to: db, tags: [], technology: "sql" }],
      },
      {
        name: db,
        label: db,
        kind: "ContainerDb",
        external: false,
        description: "",
        tags: [],
        relations: [],
      },
    );
    for (let i = 0; i < perB - 2; i++) {
      const svc = `b${b}_svc${i}`;
      elementNames.push(svc);
      const rels: Array<{ to: string; tags: string[]; technology?: string }> = [
        { to: repo, tags: [], technology: "http" },
      ];
      // 30% chance cross-boundary call to next boundary's repo
      if (i % 3 === 0) {
        const next = (b + 1) % B;
        rels.push({ to: `b${next}_repo`, tags: [], technology: "http" });
      }
      containers.push({
        name: svc,
        label: svc,
        kind: "Container",
        external: false,
        description: "",
        tags: [],
        relations: rels,
      });
    }
    const bname = `boundary_${b}`;
    boundaries.push({
      name: bname,
      label: bname,
      kind: "System",
      tags: [],
      elementNames,
      boundaryNames: [],
    });
    root.push(bname);
  }

  const { model, issues } = buildModel({
    elements: containers,
    boundaries,
    rootBoundaryNames: root,
  });
  if (issues.length) {
    console.error("synth issues:", issues.length, issues.slice(0, 3));
  }
  return model;
};

const benchModel = (label: string, model: Model): void => {
  const V = Object.keys(model.elements).length;
  const E = Object.values(model.elements).reduce(
    (s, c) => s + c.relations.length,
    0,
  );
  const B = Object.keys(model.boundaries).length;
  console.log(`\n=== ${label}  V=${V}  E=${E}  B=${B} ===`);

  const analyzeMs = measure("analyze", () => analyzeArchitecture(model));
  console.log(`  analyze              ${analyzeMs.toFixed(3)} ms`);

  for (const { name, rule } of RULES) {
    const ms = measure(name, () => rule.check(model));
    console.log(`  rule:${name.padEnd(20)} ${ms.toFixed(3)} ms`);
  }
};

const resolveFormatName = (extension: string): string | undefined => {
  if (extension === ".puml") return "plantuml";
  if (extension === ".dsl" || extension === ".json") return "structurizr";
  return undefined;
};

const loadReal = async (file: string): Promise<Model | undefined> => {
  const ext = path.extname(file).toLowerCase();
  const fmtName = resolveFormatName(ext);
  if (!fmtName) return undefined;
  const format = await loadFormat(fmtName);
  if (!canLoad(format)) return undefined;
  const res = await format.load(file);
  return res.model;
};

const main = async (): Promise<void> => {
  const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
  const repo = path.resolve(__dirname, "..");

  // Real fixtures
  const reals = [
    "fixtures/architecture/C4L2.puml",
    "fixtures/architecture/common-reuse.puml",
    "fixtures/architecture/workspace.json",
    "examples/ecommerce-structurizr/workspace.dsl",
    "examples/custom-rules/architecture.puml",
    "examples/violations-demo/workspace.dsl",
  ];
  for (const rel of reals) {
    const abs = path.join(repo, rel);
    try {
      const m = await loadReal(abs);
      if (m) benchModel(`real:${rel}`, m);
    } catch (error) {
      console.error(`skip ${rel}: ${(error as Error).message}`);
    }
  }

  // Synthetic
  benchModel("synth small  (B=10,  V≈50)", synth(10, 5));
  benchModel("synth medium (B=30,  V≈300)", synth(30, 10));
  benchModel("synth large  (B=50,  V≈1000)", synth(50, 20));
  benchModel("synth xlarge (B=100, V≈2000)", synth(100, 20));
  benchModel("synth huge   (B=200, V≈5000)", synth(200, 25));
};

main().catch((error) => {
  console.error(error);
  // eslint-disable-next-line n/no-process-exit -- standalone perf script; process.exit is the right way to signal failure to the shell
  process.exit(1);
});
