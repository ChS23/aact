import fs from "node:fs";
import path from "node:path";

import { generate } from "../../../../src/formats/plantuml/generate";
import { parseSource } from "../../../../src/formats/plantuml/parser";
import type { Boundary, Element, Model } from "../../../../src/model";

const repoRoot = path.join(__dirname, "../../../..");

const walkPuml = (dir: string): readonly string[] => {
  const out: string[] = [];
  const visit = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && full.endsWith(".puml")) out.push(full);
    }
  };
  visit(path.join(repoRoot, dir));
  return out.toSorted((a, b) => a.localeCompare(b));
};

const isDiagram = (file: string): boolean =>
  fs.readFileSync(file, "utf8").includes("@startuml");

const relative = (file: string): string => path.relative(repoRoot, file);

const blankToUndefined = (value: string | undefined): string | undefined =>
  value && value.length > 0 ? value : undefined;

const relationKey = (r: Element["relations"][number]) => ({
  to: r.to,
  description: blankToUndefined(r.description),
  technology: blankToUndefined(r.technology),
  tags: [...r.tags].toSorted(),
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
  description: b.description,
  tags: [...b.tags].toSorted(),
  elementNames: [...b.elementNames].toSorted(),
  boundaryNames: [...b.boundaryNames].toSorted(),
  link: b.link,
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

describe("PUML corpus confidence", () => {
  const firstParty = [...walkPuml("examples"), ...walkPuml("fixtures")].filter(
    isDiagram,
  );

  it.each(firstParty.map((file) => [relative(file), file]))(
    "first-party diagram parses cleanly and survives generate round-trip: %s",
    (_name, file) => {
      const original = parseSource(fs.readFileSync(file, "utf8"), file);
      expect(original.parseErrors).toEqual([]);
      expect(original.issues).toEqual([]);

      const generated = generate(original.model).files[0]?.content;
      expect(generated).toBeTruthy();

      const reparsed = parseSource(generated, file);
      expect(reparsed.parseErrors).toEqual([]);
      expect(reparsed.issues).toEqual([]);
      expect(modelKey(reparsed.model)).toEqual(modelKey(original.model));
    },
  );

  const upstreamCorpus = [
    ...walkPuml(".parser-refs/C4-PlantUML/samples"),
    ...walkPuml(".parser-refs/C4-PlantUML/percy"),
  ].filter(isDiagram);

  it.each(upstreamCorpus.map((file) => [relative(file), file]))(
    "upstream C4-PlantUML corpus never throws: %s",
    (_name, file) => {
      expect(() =>
        parseSource(fs.readFileSync(file, "utf8"), file),
      ).not.toThrow();
    },
  );
});
