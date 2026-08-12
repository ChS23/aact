import fs from "node:fs";
import path from "node:path";

import { generate } from "../../../../src/formats/plantuml/generate";
import { parseSource } from "../../../../src/formats/plantuml/parser";
import type { Boundary, Element, Model } from "../../../../src/model";

/**
 * Roundtrip corpus test — every in-scope reference fixture must
 * survive a full `parse → Model → generate → re-parse → Model` cycle
 * with the architecturally-meaningful fields preserved.
 *
 * This is the strongest possible confidence check before `aact sync`
 * lands: if a Container's identity / kind / technology / external
 * flag changes through roundtrip, we'd produce false diffs against
 * IaC manifests.
 *
 * Excluded fields (deliberately not preserved — see grammar.md §2):
 *
 *   - SourceLocation (regenerated from the generator's output —
 *     never matches the original file character offsets).
 *   - sprite (generator emits but the resulting `$sprite=...` is on
 *     a positional slot whose semantics aren't symmetric for
 *     Context family).
 *   - properties (PUML opaque per grammar.md §2).
 *   - link (generator emits as `$link=` named, but some fixtures
 *     don't carry links — empty vs undefined drift).
 *   - description on Context-family elements (Container/System/Person
 *     positional layouts diverge; the modelled values match in
 *     practice but the wire form differs).
 *
 * Surface area is: `name`, `label`, `kind`, `external`, `technology`,
 * `tags`, `relations[{ to, technology, tags }]`, boundary names,
 * `rootBoundaryNames`. These are the IaC-relevant fields per the
 * audit we did against `.parser-refs/C4-PlantUML/samples/`.
 */

const FILE = "test.puml";

const fixturesDir = path.join(
  __dirname,
  "../../../../.parser-refs/C4-PlantUML/samples",
);

const readFixture = (filename: string): string =>
  fs.readFileSync(path.join(fixturesDir, filename), "utf8");

const containerKey = (c: Element) => ({
  name: c.name,
  label: c.label,
  kind: c.kind,
  external: c.external,
  technology: c.technology,
  tags: [...c.tags].toSorted(),
  relations: [...c.relations]
    .toSorted((a, b) => a.to.localeCompare(b.to))
    .map((r) => ({
      to: r.to,
      technology: r.technology,
      tags: [...r.tags].toSorted(),
    })),
});

const boundaryKey = (b: Boundary) => ({
  name: b.name,
  label: b.label,
  kind: b.kind,
  elementNames: [...b.elementNames].toSorted(),
  boundaryNames: [...b.boundaryNames].toSorted(),
});

const modelKey = (m: Model) => ({
  containers: Object.values(m.elements)
    .map(containerKey)
    .toSorted((a, b) => a.name.localeCompare(b.name)),
  boundaries: Object.values(m.boundaries)
    .map(boundaryKey)
    .toSorted((a, b) => a.name.localeCompare(b.name)),
  rootBoundaryNames: [...m.rootBoundaryNames].toSorted(),
});

// Static / Container / Component / Context / Dynamic-new — these have
// proper round-trip semantics. Deployment fixtures are excluded
// because preParse strips deployment macros, the regenerated PUML
// won't contain them, and a second parse would (correctly) see fewer
// elements than the first did.
const ROUNDTRIPPABLE_FIXTURES: readonly string[] = [
  "C4_Component Diagram Sample - bigbankplc.puml",
  "C4_Container Diagram Sample - bigbankplc-icons.puml",
  "C4_Container Diagram Sample - bigbankplc-styles.puml",
  "C4_Container Diagram Sample - bigbankplc-themes.puml",
  "C4_Container Diagram Sample - bigbankplc.puml",
  "C4_Container Diagram Sample - message bus.puml",
  "C4_Container Diagram Sample - techtribesjs.puml",
  "C4_Context Diagram Sample - bigbankplc-landscape.puml",
  "C4_Context Diagram Sample - bigbankplc.puml",
  "C4_Context Diagram Sample - enterprise.puml",
  "C4_Dynamic Diagram Sample - bigbankplc.puml",
  "C4_Dynamic Diagram Sample - message bus.puml",
];

describe("PUML roundtrip — parser ↔ generator against reference fixtures", () => {
  it.each(ROUNDTRIPPABLE_FIXTURES)(
    "Model survives parse→generate→re-parse for %s",
    (filename) => {
      const src = readFixture(filename);
      const first = parseSource(src, FILE);
      expect(first.parseErrors).toEqual([]);

      const output = generate(first.model);
      const regen = output.files[0]?.content;
      expect(regen).toBeTruthy();

      const second = parseSource(regen, FILE);
      expect(second.parseErrors).toEqual([]);

      // Compare the architecturally-meaningful shape. If this drifts,
      // `aact sync` would surface false diffs.
      expect(modelKey(second.model)).toEqual(modelKey(first.model));
    },
  );
});
