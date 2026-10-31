# Development flow

The normal flow for three-motionbricks is **Issue → implementation → PR → review
→ revision as needed → merge**, followed by post-merge verification only when the
Issue requires it. Target `main` unless the Issue says otherwise.

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
[test and CI performance principles](testing-ci-principles.md). The current tree
contains documentation and templates; no runtime build, test commands or CI
workflows are configured. Do not invent commands or copy another repository's
setup as if it existed here. Future UI, runtime, test, or CI/build changes must
perform their own applicable checks and preserve required regression coverage.

For documentation and templates, validate Issue-template metadata, Markdown
structure, relative links and heading anchors, consistency, and whitespace using
available tooling. Run `git diff --check` (or `git diff --cached --check` for staged
changes) and review the complete diff, including new files. Do not add dependencies
solely for these checks. This documentation baseline requires no runtime build,
browser/hardware test, deployed-site check or human design approval.

## PR, review and revision

Use the [PR template](../.github/pull_request_template.md) to explain the source
problem, resulting behavior, focused changes, related Issues and validation
actually performed. Report passes, failures, skips and unavailable or unperformed
checks honestly, with reasons. Separate optional validation and pending post-merge
verification from mandatory pre-merge checks.

Use closing keywords only when the implementation fully addresses the Issue.
An intentionally partial PR must identify remaining scope, use a non-closing
reference and leave the Issue open. Genuinely post-merge-only checks may remain
pending without making an otherwise complete implementation partial.

Apply the [review and merge guidelines](review-guidelines.md). Check for both
missing requirements and unjustified additions. Fix agent-fixable findings, then
review the updated PR and relevant validation. Record necessary human decisions
or external dependencies as concrete blockers distinct from code defects; do not
repeatedly request unchanged code fixes for them.

## Merge and follow-up

Approve and merge only when the claimed scope is complete, relevant mandatory
pre-merge checks pass, and no blocking findings or genuinely necessary unanswered
questions remain. Follow the repository/workflow's existing merge authorization;
this guide does not grant permission to merge.

Record required post-merge checks as pending until performed, then report actual
results, failures and follow-up work. Pre-merge test results do not establish
deployment or publication success. No post-merge verification is required for
this documentation baseline.
