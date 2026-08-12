import { defineConfig } from "../../src";

export default defineConfig({
  source: "./architecture.dsl",
  rules: {
    crud: true,
    dbPerService: true,
    acl: true,
    cohesion: true,
  },
});
