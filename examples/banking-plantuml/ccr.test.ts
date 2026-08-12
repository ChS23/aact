import { analyzeArchitecture } from "../../src/analyze";
import { load } from "../../src/formats/plantuml/load";
import { getBoundary } from "../../src/model";

/**
 * Core diagrams https://github.com/plantuml-stdlib/C4-PlantUML/blob/master/samples/C4CoreDiagrams.md
 */
describe("Cascade coupling reduction", () => {
  it("nested boundaries: cohesion ≥ coupling and parent-attributed coupling stays in scope", async () => {
    const { model } = await load("fixtures/architecture/boundaries.puml");
    const { report } = analyzeArchitecture(model);

    for (const b of report.boundaries) {
      const couplingCount = b.couplingRelations.length;
      console.log(
        b.label,
        `, cohesion: ${b.cohesion}`,
        `, coupling: ${couplingCount}`,
      );

      // Find parent boundary if any (this boundary's name appears in some
      // other boundary's boundaryNames list).
      const parent = Object.values(model.boundaries).find((p) =>
        p.boundaryNames.includes(b.name),
      );
      if (!parent) continue;

      const childBoundary = getBoundary(model, b.name)!;
      const childContainerNames = new Set(childBoundary.elementNames);
      const parentResult = report.boundaries.find(
        (p) => p.name === parent.name,
      );
      const parentCouplingFromThisChild =
        parentResult?.couplingRelations.filter((r) =>
          childContainerNames.has(r.from),
        ).length ?? 0;

      expect(b.cohesion).toBeGreaterThanOrEqual(couplingCount);
      expect(couplingCount).toBeGreaterThanOrEqual(parentCouplingFromThisChild);

      console.log(
        `${b.cohesion} ≥ ${couplingCount} ≥ ${parentCouplingFromThisChild}`,
      );
    }
  });
});
