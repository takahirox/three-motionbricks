# Test and CI performance principles

**Detect the required failures at the lightest appropriate layer, without redundant
execution.** Preserve required correctness, regression confidence, and meaningful
integration coverage when changing where or how checks run.

## Current repository

The TypeScript/Vite demo has fast motion math, input, queue, inference-lifecycle and bundled-asset
checks (`npm test`), a type/production build (`npm run build`), a Pages artifact
check (`npm run check:pages`), and explicit browser
smoke checks (`npm run test:browser`, with `--model` for the official weights).
Browser artifacts and downloaded weights are ignored. Model tests exercise the
actual GPU boundary and are not duplicated by unit tests. The Pages workflow runs
fast tests, one build and an artifact check on `main` before publishing; it does
not download weights or install a browser. The artifact check catches accidental
weight inclusion, LFS pointers, missing files and HTML base-path regressions at
low cost; browser checks cover actual worker/WASM loading and remote CORS.
See [validation evidence](validation.md) for measured results.
Documentation checks still cover links, consistency and `git diff --check`.

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
   currently unmeasured and unset for hosted Actions. Local initial runtime
   check measurements are recorded in `validation.md`. Establish a repository-specific
   baseline and target from actual runs during future test/CI performance work,
   monitor growth, and investigate work exceeding the target. Track elapsed feedback
   time, total runner/computation time, and queue time separately. Revisit validation
   structure and duplication as costs grow, preserving required coverage. This
   documentation change requires no benchmark, universal time limit, hardware
   purchase, or additional approval gate.

Changes to triggers, test selection, timeouts, workers, caches, test implementations,
or dependencies belong in separately scoped implementation work with their own
applicable validation.
