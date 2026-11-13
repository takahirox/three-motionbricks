<!-- Write the title and body in English. Follow the development flow and language convention:
https://github.com/takahirox/three-motionbricks/blob/main/docs/development-flow.md#collaboration-language
-->

## Problem and outcome

Link the source Issue and explain the problem and resulting behavior. Include a
before/after example when useful.

## Focused changes

Describe the changes that deliver the outcome and why they are needed.

## Related Issues and remaining scope

Link related Issues. Use `Closes #<number>` when this implementation fully
addresses that Issue and applicable mandatory pre-merge checks are satisfied.
Preserve it when only post-merge verification is pending. For an intentionally
partial PR, use a non-closing reference, identify the remaining work and keep the
Issue open. State "None" if no scope remains. Genuinely post-merge-only checks may
remain pending without making a complete implementation partial.

## Validation performed

Map checks actually performed and their results to the Issue's mandatory
pre-merge criteria. Report passes, failures, skips and unavailable or unperformed
checks honestly, with reasons. Report optional validation separately.

Choose checks for the changed files and actual repository tooling using the
[validation guidance](https://github.com/takahirox/three-motionbricks/blob/main/docs/development-flow.md#implementation-and-validation).

## Required post-merge verification

List genuinely required checks possible only after merge and mark them pending
until performed, or state "None required." Keep these separate from pre-merge
validation; pre-merge results do not prove deployment or publication succeeded.
After successful merge of complete work, close the original Issue, then record
actual evidence in this PR, the closed Issue or a linked validation report. Closure
does not claim pending checks passed. Track actual defects through new or existing
linked Issues under the [follow-up lifecycle](https://github.com/takahirox/three-motionbricks/blob/main/docs/development-flow.md#merge-and-follow-up).
