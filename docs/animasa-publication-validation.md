# Issue #13 preparation validation

Checked on 2026-11-01 in the assigned worktree. This record covers rights review,
notices and non-distributing build/browser checks. It does not establish public
Animasa delivery. See the [decision and remaining acceptance](animasa-publication.md).

| Check | Result |
| --- | --- |
| GitHub Issue #13 and all six current comments | Read through the GitHub connector; assessed both the interview and the maintainer's stock-resource direction. |
| Rights evidence | Retrieved the interview pages, Unity project notice, official Crypton guidelines/PCL, two community pages and all three pinned historical text notices. Historical notice sizes/hashes match the manifest. Two community pages could not be retrieved directly; the assessment identifies them and their limits. No grant was obtained and no Animasa model/texture was downloaded. |
| `npm ci` | Passed; no new package or lockfile change. |
| `npm test` | Passed: 13 passed, 1 skipped, 0 failed. The skipped test is the existing exact-source Animasa integration test (`ANIMASA_SOURCE` is absent). |
| New Pages regression | Synthetic upload directory accepted; rejected an extra GLB, a GLB renamed as hashed JavaScript, PMD, eye bitmap, toon PNG and unreviewed conversion record. Missing required notice also rejected. Fixtures are created in a temporary directory and removed. |
| Final checker refinement | `npx tsx --test tests/pages.test.ts` and `npm run check:pages` passed again after moving filename rejection before payload reads, avoiding unnecessary reads of accidentally copied weights. |
| `npm run build` | Passed TypeScript and production Vite build. Existing large-chunk advisory remains; no build failure. |
| `npm run check:pages` | Passed: 17 files, 42.8 MB. Only SOMA/Uka character payloads, reviewed notices and generated code/runtime are allowed. No Animasa payload is included. |
| Production-prefix browser smoke | Passed with the command below, using headless Chrome 156, WebGPU rendering and the ordinary WebGL fallback checks. |
| Documentation and diff review | Relative links/anchors, Markdown fences, scope/notice consistency and `git diff --check` passed. |

Browser command, with `npm run preview -- --port 4173 --strictPort` running:

```sh
CHROME_BIN='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
DEMO_URL=http://127.0.0.1:4173/three-motionbricks/ npm run test:browser
```

The browser exercised the Animasa local-file prompt, invalid-file rejection and
replacement, and the new assertion that those operations make no character
model/texture HTTP requests or uploads. It also exercised actual Uka rendering,
visible physics response, physics-off cleanup, rapid switching, missing GLB/Ammo
recovery, keyboard/blur handling, narrow layout and WebGL fallback. Existing
negative inference-host tests intentionally produce a model-host failure in the
final diagnostics; this is an expected assertion, not a successful inference run.
Generated browser reports/screenshots remain in ignored `.artifacts/`.

Not run for this change:

- Exact Animasa conversion and valid-file browser branch: no `ANIMASA_SOURCE`
  or `ANIMASA_GLB` supplied. Existing #11 measurements remain historical evidence;
  this change preserves the converter, retargeter, solver and physics runtime.
- Real-model locomotion (`--model`) and IK comparison: no motion implementation
  changed, and the 758 MB inference weights were not downloaded for these checks.
- Automatic Animasa loading, Pages deployment or published-origin smoke: rights
  scope remains unresolved, so automatic delivery is not enabled. This node also
  has explicit instructions not to push, open a PR, merge or publish.

The current preparation has no required post-merge check. Issue #13 remains open
for the distribution evidence, authorized automatic delivery and its pre-merge
and published-origin checks described in the linked plan. No remote mutation,
rights-holder contact, usage reset, allowance purchase or model/provider switch
was performed.
