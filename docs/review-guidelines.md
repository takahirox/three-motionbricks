# Review and merge guidelines

Follow the [development flow](development-flow.md), including its
[English collaboration convention](development-flow.md#collaboration-language).

## Review scope and quality

Read the current Issue and relevant discussion, the complete PR diff including new
files, and validation evidence. Check both directions:

- **Missing work:** verify every requirement and mandatory pre-merge criterion
  within the claimed scope is implemented and validated. A PR claiming to close
  an Issue must fully address it; an intentionally partial PR must identify
  remaining work and keep the Issue open.
- **Unjustified additions:** question unrelated refactoring, speculative
  abstractions, frameworks, extra policies or configuration without a demonstrated
  need. Prefer the smallest coherent change that satisfies the Issue; simplicity
  must not excuse missing requirements or necessary validation.

Check correctness, consistency with justified repository conventions, and affected
documentation. For applicable UI changes, review the result against the canonical
[UI/UX and layout principles](../README.md#uiux-and-layout).

## Evaluate validation

Use the [validation guidance](development-flow.md#implementation-and-validation).
Checks must fit the changed files and actual repository tooling. Verify that
reported passes, failures, skips and unavailable or unperformed checks match what
was actually done, with reasons for gaps. For documentation and templates, check
metadata, Markdown structure, links, anchors, consistency and whitespace; unrelated
runtime checks or new tooling are not required.

Mandatory pre-merge criteria must be achievable and verifiable before merge.
Keep optional validation separate. Human input, subjective review, physical
hardware or external approval is required only when necessary to the actual
Issue, with a reason and expected result.

Genuinely required post-merge-only checks remain pending until performed and
cannot be pre-merge prerequisites. In particular, merge-triggered deployment or
publication is verified after merge; pre-merge tests do not establish its success.
This does not waive implementation requirements or applicable pre-merge checks.
Do not add post-merge work routinely.

## Review outcomes and merge

- **Changes needed:** describe each agent-fixable finding with the affected
  requirement or location, concrete problem and expected correction. Review the
  updated PR and relevant validation after the fix.
- **Blocked on a decision or dependency:** identify the concrete blocker, why
  human input or an external result is necessary, and the decision or evidence
  needed. Keep this distinct from code defects. Resume review when resolved;
  do not repeatedly request unchanged code fixes or treat silence as approval.
- **Ready:** approve only when the claimed scope is complete, relevant mandatory
  pre-merge checks pass, no unjustified additions remain, and no blocking findings
  or genuinely necessary unanswered questions remain. For a partial PR, ensure
  the remaining scope is explicit and the Issue stays open.

Merge only under the repository/workflow's existing authorization, targeting
`main` unless the Issue specifies otherwise. Pending required post-merge checks
do not prevent approval when the pre-merge conditions hold. After merge, perform
those checks and record actual results and any follow-up work; keep unperformed
checks pending.
