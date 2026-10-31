# three-motionbricks

This repository is at its initial collaboration baseline, with contribution
guidance and templates in place for future implementation and examples.

## Contributing

Start with the [Issue template](.github/ISSUE_TEMPLATE/issue.md) and follow the
[development flow](docs/development-flow.md), including the
[English collaboration convention](docs/development-flow.md#collaboration-language).
Use the [PR template](.github/pull_request_template.md) and the
[review and merge guidelines](docs/review-guidelines.md), together with the
[test and CI performance principles](docs/testing-ci-principles.md).
[AGENTS.md](AGENTS.md) is the entry point for AI contributors.

## UI/UX and layout

Apply these principles to this repository's examples and user-facing surfaces as
they are developed:

1. **Keep it simple.** Show only necessary information and actions; avoid unnecessary UI elements.
2. **Show, don't tell.** Prefer layout, spacing and visual hierarchy over explanatory labels or prose to communicate structure.
3. **Intuitive and predictable.** Keep appearance and behavior consistent with user expectations; don't interrupt the user's work.

- Give the primary content, result or preview clear visual priority where
  applicable. Group related controls near what they affect and make the next
  useful action apparent.
- Use hierarchy, alignment, spacing and grouping to communicate relationships.
  Remove redundant headings, repeated helper copy and decorative status prose.
- Keep ordinary, necessary actions visible. Reveal contextual or advanced controls
  when relevant; do not hide everyday actions merely to make a screen sparse.
- Preserve readable responsive layouts, predictable navigation, keyboard operation,
  visible focus, accessible control names, meaningful labels and errors.
  "Show, don't tell" does not remove information needed to operate the interface.
- Keep necessary consent and destructive-action safeguards where applicable.
  Require a concrete user-facing reason for new controls, panels, steps or UI
  complexity.
