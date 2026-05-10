import { Boundary } from "./boundary";
import { Container } from "./container";

export interface ArchitectureModel {
  readonly boundaries: Boundary[];
  readonly allContainers: Container[];
}
