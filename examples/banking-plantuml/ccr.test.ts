import { analyzeArchitecture, BoundaryAnalysis } from "../../src/analyzer";
import {
  loadPlantumlElements,
  mapContainersFromPlantumlElements,
} from "../../src/loaders/plantuml";

/**
 * Core diagrams https://github.com/plantuml-stdlib/C4-PlantUML/blob/master/samples/C4CoreDiagrams.md
 */
describe("Cascade coupling reduction", () => {
  it("test1", async () => {
    const pumlElements = await loadPlantumlElements(
      "resources/architecture/boundaries.puml",
    );
    const model = mapContainersFromPlantumlElements(pumlElements);
    const BoundariesReport = analyzeArchitecture(model);

    for (const b of BoundariesReport.report.boundaries) {
      console.log(
        b.label,
        `, cohesion: ${b.cohesion}`,
        `, coupling: ${b.couplingRelations.length}`,
      );

      const parentBoundary = BoundariesReport.report.boundaries.find(
        (pb: BoundaryAnalysis) =>
          BoundariesReport.model.boundaries
            .find((mb) => mb.name === pb.name)
            ?.boundaries.some((child) => child.name === b.name) ?? false,
      );

      if (parentBoundary) {
        const childBoundary = BoundariesReport.model.boundaries.find(
          (mb) => mb.name === b.name,
        )!;
        const childContainerNames = new Set(
          childBoundary.containers.map((c) => c.name),
        );

        const parentCoupling = parentBoundary.couplingRelations.filter((r) =>
          childContainerNames.has(r.from),
        ).length;

        expect(b.cohesion).toBeGreaterThanOrEqual(b.couplingRelations.length);
        expect(b.couplingRelations.length).toBeGreaterThanOrEqual(
          parentCoupling,
        );

        console.log(
          `${b.cohesion} ≥ ${b.couplingRelations.length} ≥ ${parentCoupling}`,
        );
      }
    }
  });
});
