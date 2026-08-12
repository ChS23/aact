import fs from "node:fs";
import path from "node:path";

import { load } from "../../../../src/formats/structurizr/load";
import { parseSource } from "../../../../src/formats/structurizr/parser";
import type { Boundary, Element, Model, Relation } from "../../../../src/model";

const repoRoot = path.join(__dirname, "../../../..");

const walkDsl = (dir: string): readonly string[] => {
  const root = path.join(repoRoot, dir);
  if (!fs.existsSync(root)) return [];

  const out: string[] = [];
  const visit = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && full.endsWith(".dsl")) out.push(full);
    }
  };
  visit(root);
  return out.toSorted((a, b) => a.localeCompare(b));
};

const relative = (file: string): string => path.relative(repoRoot, file);

const blankToUndefined = (value: string | undefined): string | undefined =>
  value && value.length > 0 ? value : undefined;

const normalizedProperties = (
  properties: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> | undefined => {
  if (!properties) return undefined;
  const entries = Object.entries(properties).filter(
    ([key]) => key !== "structurizr.dsl.identifier",
  );
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries.toSorted(([a], [b]) => a.localeCompare(b)));
};

const relationKey = (r: Relation) => ({
  to: r.to,
  description: blankToUndefined(r.description),
  technology: blankToUndefined(r.technology),
  tags: [...r.tags].toSorted(),
  link: r.link,
  properties: normalizedProperties(r.properties),
});

const elementKey = (e: Element) => ({
  name: e.name,
  label: e.label,
  kind: e.kind,
  external: e.external,
  description: blankToUndefined(e.description),
  technology: blankToUndefined(e.technology),
  tags: [...e.tags].toSorted(),
  sprite: e.sprite,
  link: e.link,
  properties: normalizedProperties(e.properties),
  relations: e.relations
    .map(relationKey)
    .toSorted((a, b) =>
      `${a.to}|${a.description}|${a.technology}`.localeCompare(
        `${b.to}|${b.description}|${b.technology}`,
      ),
    ),
});

const boundaryKey = (b: Boundary) => ({
  name: b.name,
  label: b.label,
  kind: b.kind,
  description: blankToUndefined(b.description),
  tags: [...b.tags].toSorted(),
  elementNames: [...b.elementNames].toSorted(),
  boundaryNames: [...b.boundaryNames].toSorted(),
  link: b.link,
  properties: normalizedProperties(b.properties),
});

const modelKey = (m: Model) => ({
  elements: Object.values(m.elements)
    .map(elementKey)
    .toSorted((a, b) => a.name.localeCompare(b.name)),
  boundaries: Object.values(m.boundaries)
    .map(boundaryKey)
    .toSorted((a, b) => a.name.localeCompare(b.name)),
  rootBoundaryNames: [...m.rootBoundaryNames].toSorted(),
});

describe("Structurizr DSL corpus confidence", () => {
  const firstParty = walkDsl("examples");

  it.each(firstParty.map((file) => [relative(file), file]))(
    "first-party DSL parses cleanly: %s",
    (_name, file) => {
      const result = parseSource(fs.readFileSync(file, "utf8"), file);
      expect(result.parseErrors).toEqual([]);
      expect(result.issues).toEqual([]);
    },
  );

  const firstPartyPairs = firstParty
    .map((dsl) => [dsl, dsl.replace(/\.dsl$/u, ".json")] as const)
    .filter(([, json]) => fs.existsSync(json));

  it.each(firstPartyPairs.map(([dsl, json]) => [relative(dsl), dsl, json]))(
    "first-party DSL matches compiled Structurizr JSON: %s",
    async (_name, dsl, json) => {
      const dslResult = await load(dsl);
      const jsonResult = await load(json);

      expect(dslResult.issues).toEqual([]);
      expect(jsonResult.issues).toEqual([]);
      expect(modelKey(dslResult.model)).toEqual(modelKey(jsonResult.model));
    },
  );

  const upstreamCorpus = [
    ...walkDsl(".parser-refs/java/structurizr-dsl/src/test/resources/dsl"),
    ...walkDsl(".parser-refs/java/structurizr-export/src/test/resources"),
  ];

  it.each(upstreamCorpus.map((file) => [relative(file), file]))(
    "upstream Structurizr DSL corpus never throws: %s",
    (_name, file) => {
      expect(() =>
        parseSource(fs.readFileSync(file, "utf8"), file),
      ).not.toThrow();
    },
  );
});
