# Development flow

The normal flow for three-motionbricks is **Issue → implementation → PR → review
→ revision as needed → merge and close the original Issue**, followed by
post-merge verification only when the actual change requires it. Target `main`
unless the Issue says otherwise. Intentionally partial work leaves the parent
Issue open as described below.

## Collaboration language

Use **English** for newly authored templates, development/review/merge and UI/UX
documentation, AI instructions, Issue and PR titles and bodies, review comments,
and commit messages. This does not require translating historical material,
changing product localization, or changing the language used in the maintainer's
chat.

## Scope and acceptance

Use the [Issue template](../.github/ISSUE_TEMPLATE/issue.md). Treat the current
Issue and relevant discussion as the scope reference. Resolve genuinely blocking
ambiguity before dependent work. Choose the smallest coherent change that fully
satisfies the Issue, preserving useful existing content and justified conventions.
Avoid unrelated refactoring, speculative abstractions, frameworks and extra
policies or configuration without a demonstrated need. Simplicity does not excuse
omitted requirements or necessary validation.

Separate three categories in the Issue and PR:

- **Mandatory pre-merge acceptance:** implementation requirements and checks
  achievable and verifiable before merge.
- **Optional validation:** useful additional checks that are not completion gates.
- **Required post-merge verification:** genuinely necessary checks possible only
  after merge. State "None required" when none are needed.

Default to criteria an AI implementer can execute and verify. Require human input,
subjective review, physical hardware or external approval only when necessary for
the actual Issue, explaining why and what result is needed. A merge-triggered
deployment or publication cannot be a pre-merge prerequisite. This separation
does not waive implementation requirements or applicable pre-merge checks.

For work owned by another managed repository, the default handoff is a linked
`task` Issue in that repository. The current repository's Task must not create a
cross-repository branch or PR unless explicitly instructed; the receiving
repository's own Task workflow owns implementation and review.

## Implementation and validation

Inspect the current tree and repository instructions before editing. Choose checks
for the changed files and the repository's actual tooling, following the
[test and CI performance principles](testing-ci-principles.md). The tree includes
a TypeScript/Vite browser demo. Use `npm test` for motion math,
queue and asset regressions, and `npm run build` for type and production bundling
checks. Browser/model checks are documented in the README and `docs/validation.md`.
The Pages workflow runs the fast tests, production build and artifact checks on
`main` before deployment. Match checks to the change and preserve required
regression coverage.

For documentation and templates, validate Issue-template metadata, Markdown
structure, relative links and heading anchors, consistency, and whitespace using
available tooling. Run `git diff --check` (or `git diff --cached --check` for staged
changes) and review the complete diff, including new files. Do not add dependencies
solely for these checks. This documentation baseline requires no runtime build,
browser/hardware test, heavyweight model download, deployed-site check or human
design approval.

## PR, review and revision

Use the [PR template](../.github/pull_request_template.md) to explain the source
problem, resulting behavior, focused changes, related Issues and validation
actually performed. Report passes, failures, skips and unavailable or unperformed
checks honestly, with reasons. Separate optional validation and pending post-merge
verification from mandatory pre-merge checks.

Use the normal `Closes #N` reference when the implementation fully addresses the
Issue and applicable mandatory pre-merge checks are satisfied. An intentionally
partial PR must identify remaining scope, use a non-closing reference and leave
the parent Issue open. Genuinely post-merge-only checks may remain pending without
making an otherwise complete implementation partial. Preserve the closing
reference in that case: requesting its removal solely for pending post-merge
verification makes review and ProjectWeave publication undo each other in a
Review → Fix → Publish → Review loop.

Apply the [review and merge guidelines](review-guidelines.md). Check for both
missing requirements and unjustified additions. Fix agent-fixable findings, then
review the updated PR and relevant validation. Record necessary human decisions
or external dependencies as concrete blockers distinct from code defects; do not
repeatedly request unchanged code fixes for them.

## Merge and follow-up

Approve and merge only when the claimed scope is complete, relevant mandatory
pre-merge checks pass, and no blocking findings or genuinely necessary unanswered
questions remain. Missing implementation, mandatory pre-merge tests, required
protections and genuinely necessary pre-merge human acceptance remain blockers.
Follow the repository/workflow's existing merge authorization; this guide does
not grant permission to merge or bypass checks or reviews.

After a successful merge of complete work, close the original Issue, then perform
genuinely required post-merge checks. Record evidence in the merged PR, closed
Issue or a linked validation report, identifying the affected revision and actual
results. Keep unperformed, pending or environment-blocked checks labeled honestly,
with reasons; Issue closure does not claim they passed. Pre-merge test results do
not establish deployment or publication success. An unavailable test environment
alone is not evidence of a product defect.

If verification finds an actual defect, check for an existing equivalent Issue
first. Link that Issue or create a new linked Issue with reproduction steps,
affected revision, expected/actual behavior and links to the original Issue/PR.
Do not keep or reopen the original Issue solely for post-merge follow-up.

This lifecycle supersedes older instructions in guides or validation reports to
keep an implemented Issue open solely for post-merge verification. Preserve
historical test outcomes and evidence; this changes closure handling, not results,
implementation requirements or existing verification requirements. Do not add
post-merge checks routinely. None are required for this documentation baseline.
