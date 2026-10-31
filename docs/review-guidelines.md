# Review guidelines

Review the complete diff against the Issue, checking for missing requirements and
unjustified additions. Apply the [test and CI performance principles](testing-ci-principles.md)
when assessing validation:

> Does this change provide sufficient confidence with the lightest appropriate
> validation, without redundant execution?

For new or expanded checks, identify the additional defect coverage, overlap with
existing checks, and added execution and maintenance cost. Preserve necessary
assertions, regressions, and integration coverage when checks move between layers.

Verify that applicable mandatory pre-merge checks passed and that reported skips,
unavailable checks, optional validation, and pending post-merge work are explicit.
Resolve blocking findings before merge under the applicable workflow authorization.
