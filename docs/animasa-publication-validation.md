# Animasa public-delivery validation — Issue #13

Validated on 2026-11-01 in the assigned worktree. This supersedes the earlier
preparation-only record. The repository owner's updated Issue resolves the
redistribution prerequisite; this records that maintainer decision, not a new
third-party grant. Original notices and character/model conditions remain intact.

Environment: Node 26.12.1, npm 11.20.0, system headless Chrome 156 on macOS,
WebGPU rendering. Production preview is isolated at
`http://127.0.0.1:4179/three-motionbricks/`; port 8765 and other Projects were not
used or changed. No new dependency, model/provider switch, allowance purchase,
usage reset or ticket redemption was used.

## Mandatory pre-merge evidence

| Check | Actual result |
| --- | --- |
| `npm ci` | Passed; 62 packages audited, zero reported vulnerabilities. |
| Exact pinned source acquisition | All six source files matched manifest lengths/SHA-256 before conversion, including the three original notices. No unpinned model or texture input. |
| `npm run assets:animasa -- .cache/animasa-source --publish` | Passed; actual stock PMD converted with the #11 pipeline and current publication metadata. |
| `ANIMASA_SOURCE=.cache/animasa-source npm test` | Passed: 14 tests, no skips/failures. Includes two byte-identical conversions, GLB identity, skins/morphs/bones, all collision masks, solver metadata, retargeting, independent hair/skirt response and native cleanup. |
| `npm run build` | Passed: type checking and production bundling; existing large-JS-chunk warning remains. No source/weights download during build. |
| `npm run check:pages` | Passed: 23 files, 44.0 MB; exact six Animasa files and reviewed SOMA/Uka/runtime assets only. Every Animasa file's size/hash checked. |
| Artifact negative regressions | Passed: reject unrelated GLBs, a GLB renamed as generated JS, raw PMD, loose eye/toon textures, unreviewed records, changed GLB size/hash and missing required notices. |
| `CHROME_BIN=<system Chrome> DEMO_URL=http://127.0.0.1:4179/three-motionbricks/ npm run test:browser -- --animasa` | Passed: automatic exact Animasa GET 200, all asset/notice response hashes, toon/outline skin, visible physics on/off, valid local override without transfers, invalid override recovery, clearing override, Uka/SOMA switching, rapid cancellation and unchanged native allocation count. Missing/corrupt public GLB, missing Ammo and retry passed. Keyboard/blur, 390px layout, missing weights/network/LFS pointer, missing SOMA and unavailable-WebGPU/WebGL preview regressions passed. No uncaught page errors. |
| Workflow YAML | Parsed with Ruby/Psych. PRs to main run build/tests/artifact checks; upload/deploy remain main-only with existing job permissions. PR concurrency is separate from deployments. |

Published conversion: **1,220,308 bytes**, SHA-256
`cc3bd0a0c5620a248dda1bbb8b7e2c97aab7c8d863ef9a6add817bd56311cc07`.
All required eye/toon PNGs are embedded. The asset README, conversion record and
three original byte-preserved notices are included. No loose texture, source
PMD, VMD or model weights are included. The changed publication extras explain
the output hash change from the historical local-only conversion.

The production browser's initial Animasa capture recorded 240 physics steps,
376 native allocations and maximum secondary rotation
1.07 radians; physics on/off changed 15,954 scene pixels. Exact-source integration independently
asserts both hair and skirt response, finite transforms and zero leaked native
handles. Screenshots and generated motion traces remain under ignored `.artifacts/`.
These metrics detect behavior, not full original-MMD fidelity or foot locking.

### Actual-model WebGPU inference and IK

Both production-prefix commands passed with
`MODEL_CACHE=.cache/mmm_v6_soma_fp32.onnx CHROME_BIN=<system Chrome>` and the
`DEMO_URL` above:

```sh
npm run test:browser -- --model --animasa
npm run test:browser -- --model --mmd
npm run check:mmd-ik -- --animasa .artifacts/animasa-movement.json
```

The test-only cache server streams the official **757,864,273-byte** payload only
after verifying SHA-256
`856419dc72aeb14e591eebf4dd0ea05734a2506ddb00bcd39dd6dac2ad60f4fb`.
It redirects only ONNX, leaving automatic Animasa and every other production
asset request unchanged. Actual upstream HEAD returned 200, the exact length,
`Access-Control-Allow-Origin: *` and cross-origin resource policy; the direct
browser GET made progress at about 0.2 MB/s and was intentionally stopped before
completion. A range-verified acquisition supplied the same pinned bytes for the
GPU regressions, avoiding repeated full transfers. These runs prove actual
inference with the official payload; they do not claim a completed direct remote
browser download or published-origin verification.

| Character | Load | Generations at stop | Maximum displayed root step | Final stopped-second travel |
| --- | --- | --- | --- | --- |
| Animasa Miku | 2.266 s | 13 | 0.081 m | 0.010 m |
| CG-CA Uka | 2.237 s | 13 | 0.280 m | 0.000 m |

Both checked generated walk/run/turn/stop, expected travel directions, upright
torso, active physics, no uncaught page errors, switching to SOMA with generation
continuing, and return to MMD without extra native allocations. Chrome reported
Apple Metal-3, ORT 1.31.1, WebGPU rendering and default CPU/WASM fallback for
unsupported/shape operations. Inspected Animasa run/stop screenshots show the
actual model with trailing hair during movement and hanging hair after stop.
No prerecorded animation or Uka substitution was used for Animasa acceptance.

The IK experiment uses those actual generated poses and the published Animasa
rig, comparing FK against foot-position-driven ankle/toe IK:

| State | Frames | Mean IK displacement | Minimum FK foot height | Minimum IK foot height |
| --- | --- | --- | --- | --- |
| walk | 26 | 5.41 cm | -1.78 cm | -2.98 cm |
| run | 26 | 7.58 cm | -1.98 cm | -3.13 cm |
| turn | 26 | 5.48 cm | -2.24 cm | -3.37 cm |
| stop | 58 | 5.69 cm | 1.54 cm | -2.06 cm |

IK increased maximum sampled foot travel in every state and lowered the stopped
feet below ground. Retain the #11 FK leg/toe policy, four retained disabled
leg/toe chains, eight active grants, and physics ownership of overlapping
hair/necktie chains. This does not claim foot locking or full fixed-axis support.

Restoring only the former publication extra in the new GLB reproduces the exact
historical #11 hash `d50f975328ea85c20efb0cba023bc6ec0fa06e07f7be5ee8c12bad24ab220e97`;
the binary skin/texture/physics payload is unchanged. Relative Markdown file
links and staged whitespace checks passed, including original notices with
attributes preserving their exact bytes and line endings.

## PR publication and current-head CI

Read GitHub PR #14 on 2026-11-01: draft, head
`0659d38d81c5078a349d1fd348e6c5d532e39dba`, with **no status checks**. The latest
successful Pages run was for main `9790945e1434fff138349d236863f48eb40d5c99`,
not this implementation. Those results are not reported as current-change CI.
This node commits locally and does not push or merge. After publishing its
checkpoint to PR #14, update the title/body to describe automatic Animasa delivery,
wait for the actual new head's build check, review that diff and only then mark
ready if all mandatory checks pass. Keep a non-closing reference to Issue #13.

Suggested title: `feat: automatically load the pinned Animasa Miku demo asset (#13)`.
The description should cover automatic same-origin delivery, original notices,
maintainer decision, preserved local override/SOMA/Uka behavior, the evidence
above, actual new-head CI, and the pending post-merge checks below. Do not retain
the former preparation-only or rights-blocked description.

## Required post-merge verification — pending

No deployment or published-origin success is claimed by these local checks.
After an authorized merge, verify the successful Pages workflow at the merged
revision and repeat the production browser checks (including real inference)
at `https://takahirox.github.io/three-motionbricks/`. Confirm automatic exact-model
loading, asset/notice hashes and successful network responses, Animasa
walk/run/turn/stop, physics, switching/recovery and SOMA/Uka regressions. Keep
Issue #13 open until those checks actually succeed. Do not substitute a locally
supplied GLB for automatic public loading in the post-merge acceptance.

Optional validation: other browsers/GPUs, lower-memory devices and subjective
animation polish remain unperformed.
