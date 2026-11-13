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
Checks must fit the changed files and actual repository tooling. Apply the
[test and CI performance principles](testing-ci-principles.md):

> Does this change provide sufficient confidence with the lightest appropriate
> validation, without redundant execution?

For new or expanded checks, identify the additional defect coverage, overlap with
existing checks, and added execution and maintenance cost. Preserve necessary
assertions, regressions, and integration coverage when checks move between layers.

Verify that reported passes, failures, skips and unavailable or unperformed
checks match what was actually done, with reasons for gaps. For documentation and
templates, check metadata, Markdown structure, links, anchors, consistency and
whitespace; unrelated runtime checks or new tooling are not required.

Mandatory pre-merge criteria must be achievable and verifiable before merge.
Keep optional validation separate. Human input, subjective review, physical
hardware or external approval is required only when necessary to the actual
Issue, with a reason and expected result.

Genuinely required post-merge-only checks remain pending until performed and
cannot be pre-merge prerequisites. In particular, merge-triggered deployment or
publication is verified after merge; pre-merge tests do not establish its success.
This does not waive implementation requirements or applicable pre-merge checks.
Pending post-merge-only verification does not make complete implementation partial.
Do not add post-merge work routinely, including manual approval, physical-device,
heavyweight model download or deployment gates for documentation changes.

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
  the remaining scope is explicit and the parent Issue stays open without a closing
  reference. Missing implementation, mandatory pre-merge tests, required protections
  and genuinely necessary pre-merge human acceptance remain blockers.

Merge only under the repository/workflow's existing authorization, targeting
`main` unless the Issue specifies otherwise. When the implementation is complete
and pre-merge conditions hold, preserve `Closes #N`. Do not request removing it,
keeping the source Issue open or withholding approval solely because a
post-merge-only check is pending. That would cause the Review → Fix → Publish →
Review loop described in the [development flow](development-flow.md#pr-review-and-revision).

After successful merge of complete work, close the original Issue and then perform
genuinely required checks under the [follow-up lifecycle](development-flow.md#merge-and-follow-up).
Record accurate evidence in the merged PR, closed Issue or linked validation
report. Closure does not turn pending, unperformed or environment-blocked checks
into passes; environment unavailability alone does not establish a product defect.
For an actual defect, check for an equivalent Issue before creating a new linked
Issue with reproduction steps, affected revision, expected/actual behavior and
original Issue/PR links. Do not reopen the original solely for this follow-up.
The current lifecycle supersedes older closure instructions without rewriting
historical results or waiving existing verification requirements.
