# Test and CI performance principles

**Detect the required failures at the lightest appropriate layer, without redundant
execution.** Preserve required correctness, regression confidence, and meaningful
integration coverage when changing where or how checks run.

## Current repository

three-motionbricks is being bootstrapped. No application code, test commands,
build configuration, or CI workflows are present. Current documentation checks
cover Markdown structure, links and anchors, consistency, whitespace
(`git diff --check`), and review of the complete diff, including new files.
The principles below guide these checks and future test/CI additions; they do not
introduce commands, workflows, or a new merge gate.

## Principles

1. **Prefer the lightest meaningful layer.** Use fast unit/component tests for
   calculations, branches, and broad data combinations when code is added. Reserve
   browser, renderer, emulator, real-model, and end-to-end checks for behavior or
   boundaries that require those environments. Each test should catch a concrete
   defect; avoid assertions that merely mirror the implementation.
2. **Choose combinations deliberately.** Cover distinct processing paths with
   representative cases. Do not automatically multiply every format, model,
   material, state, browser, and deployment path. Use exhaustive combinations where
   their interactions require them, retaining required regressions and meaningful
   integration coverage when redistributing checks.
3. **Match validation to the change.** Documentation-only changes need the current
   documentation checks. Future UI changes need relevant interaction, accessibility,
   and rendering checks; core/runtime changes need relevant behavior and regression
   checks; CI/build changes need checks of the affected pipeline and artifacts.
   Give fast feedback, full regression validation, and deployment/publication
   distinct responsibilities and appropriate triggers. Run applicable mandatory
   checks before merge. Label extra exploratory validation as optional; record work
   that genuinely requires a merge, such as merge-triggered publication verification,
   separately as pending post-merge work. No post-merge verification is required
   solely for adding these principles.
4. **Reuse work and eliminate duplicate execution.** When expensive setup exists,
   reuse builds, converted fixtures, and downloads with cache keys that reflect
   their inputs and environment, keeping runs isolated. Avoid equivalent push and
   PR checks for the same revision. Cancel superseded runs when safe while
   preserving necessary deployment ordering. Parallelize independent work based on
   measured elapsed time and resource use; more workers do not guarantee improvement.
5. **Review value and cost together.** For each new or expanded check, name the
   additional defect it detects, assess whether existing coverage supplies that
   assurance, and consider execution and maintenance cost. Watch repeated fresh
   browser/renderer/compiler setup, large fixtures, long emulation loops, and growth
   from multiplying combinations. Retain meaningful assertions and required coverage.
6. **Maintain an execution-time budget.** The normal-CI baseline and target are
   currently unmeasured and unset because no CI exists. Establish a repository-specific
   baseline and target from actual runs during future test/CI performance work,
   monitor growth, and investigate work exceeding the target. Track elapsed feedback
   time, total runner/computation time, and queue time separately. Revisit validation
   structure and duplication as costs grow, preserving required coverage. This
   documentation change requires no benchmark, universal time limit, hardware
   purchase, or additional approval gate.

Changes to triggers, test selection, timeouts, workers, caches, test implementations,
or dependencies belong in separately scoped implementation work with their own
applicable validation.
