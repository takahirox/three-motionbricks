# Development flow

Use the Issue and relevant discussion to define scope, then implement, open a PR,
review, revise as needed, and merge under the applicable workflow authorization.
Keep the change focused and report the validation actually performed, including
failures, skips, and unavailable checks.

Choose validation using the [test and CI performance principles](testing-ci-principles.md).
Identify mandatory pre-merge checks, optional validation, and genuinely
post-merge-only work separately. For documentation-only changes, check Markdown
structure, links and anchors, consistency, and whitespace with `git diff --check`;
review the complete diff, including new files. No runtime suite is configured.

Future UI, runtime, test, or CI/build changes must perform their own applicable
checks and preserve required regression coverage. Record required post-merge
verification as pending until performed; pre-merge results do not prove deployment
or publication succeeded.
