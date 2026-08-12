import type { ChangelogConfig } from "changelogen";

// changelogen — UnJS-aligned CHANGELOG.md generator from conventional commits.
// Workflow: write commits in conventional format (we have commitlint enforcing
// it), then run `pnpm release` to bump version, generate CHANGELOG section,
// commit, and tag.
//
// Reference: https://github.com/unjs/changelogen
export default <Partial<ChangelogConfig>>{
  // Github org/repo for issue + PR + compare links in CHANGELOG.
  repo: "Byndyusoft/aact",
  // Hide author email in the contributors footer — keep CHANGELOG public-safe.
  hideAuthorEmail: true,
  // Sections in display order. Anything not listed is hidden.
  types: {
    feat: { title: "Features" },
    perf: { title: "Performance" },
    fix: { title: "Fixes" },
    refactor: { title: "Refactors" },
    docs: { title: "Documentation" },
    test: { title: "Tests" },
    build: { title: "Build" },
    chore: { title: "Chore" },
  },
};
