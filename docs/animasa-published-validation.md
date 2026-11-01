# Animasa published-origin verification — Issue #13

## Merge and deployment

On 2026-11-01, immediately before merging, Issue #13 was read from GitHub and
confirmed open. PR #14 was ready, mergeable without conflicts, and still at the
reviewed head `b30ad46a1e1010ebb5a587261b14c035fbf32580`. Its current-head
[CI run](https://github.com/takahirox/three-motionbricks/actions/runs/41310466024)
passed. The upstream review approved that exact head without blocking findings.

GitHub merged with `merge_method=merge` and that expected head SHA, producing
`3c8e750ddfb22a7b0af4bedf025b683d0caac545`; no policy bypass was used.
The [Pages workflow](https://github.com/takahirox/three-motionbricks/actions/runs/41310839688)
passed build, tests, artifact checks and deployment for that merge. GitHub Pages
deployment `7473582423` reported success at
<https://takahirox.github.io/three-motionbricks/>.

## Published-origin browser checks

System headless Chrome 156 on macOS used the actual HTTPS Pages URL, without a
local GLB override for automatic-loading acceptance. The six Animasa files,
including conversion provenance and all three unchanged original notices,
returned HTTP 200 and matched every size/SHA-256 in
`scripts/animasa-public-files.json`. The GLB was 1,220,308 bytes with SHA-256
`cc3bd0a0c5620a248dda1bbb8b7e2c97aab7c8d863ef9a6add817bd56311cc07`.
Its HEAD response had `Content-Type: model/gltf-binary` and
`Access-Control-Allow-Origin: *`. Required eye/toon textures are embedded.

The published smoke passed automatic loading, toon/outline rendering, optional
valid/invalid local override and clearing, visible physics on/off, cancellation,
resource cleanup, Animasa/SOMA/Uka switching, keyboard/blur handling and 390px
layout. Simulated missing/corrupt Animasa, missing Ammo and retry, missing Uka and
SOMA, failed/missing/LFS-pointer weights and unavailable-WebGPU/WebGL fallback
checks passed. The expected simulated network error in the smoke report is part
of that error-recovery test, not a spontaneous production failure.

The initial unmodified smoke timed out at its 30-second Uka wait. A test-only
copy increased default browser waits to 180 seconds and logged Uka responses;
the first successful Uka download took 35.035 seconds and returned HTTP 200.
All original assertions were retained; application code and deployed assets were
unchanged. The longer-timeout run exited successfully.

Published Animasa preview measured 239 physics steps, 376 native allocations,
maximum secondary rotation 0.853 radians and 16,065 changed physics-on/off scene
pixels. Its screenshot was inspected and showed the actual Animasa character
with toon shading, outlines and long hair.

## Actual inference — passed

The longer-timeout browser harness passed both `--model --animasa` and
`--model --mmd` at the published HTTPS URL. Both tested generated walk/run/turn/stop,
expected movement directions, upright torso, active secondary physics, stopped
travel, switching to SOMA with generation continuing, and returning to MMD without
extra native allocations. No uncaught page errors occurred. Animasa run/stop
screenshots were inspected; they show the actual model and secondary hair motion.
The existing FK leg/toe policy and pre-merge actual-model IK comparison are
unchanged; these results do not claim foot locking or full original-MMD fidelity.

| Character | ONNX load | Generations at stop | Maximum root step | Final stopped-second travel | Native allocations |
| --- | --- | --- | --- | --- | --- |
| Animasa Miku | 33.646 s | 13 | 0.081 m | 0.010 m | 376 |
| CG-CA Uka | 42.054 s | 15 | 0.280 m | 0.000 m | 1,472 |

The browser reported Apple Metal-3, WebGPU rendering and ORT 1.31.1, with the
documented CPU/WASM fallback for unsupported/shape operations. Machine-readable
results are in [animasa-published-validation.json](animasa-published-validation.json).

Only ONNX used the test-only cache redirect. It was acquired from the pinned
official remote URL with validated HTTP ranges, then verified as 757,864,273 bytes
and SHA-256 `856419dc72aeb14e591eebf4dd0ea05734a2506ddb00bcd39dd6dac2ad60f4fb`.
All application, character, embedded-texture, notice and runtime assets came from
Pages. Automatic Animasa loading used no locally supplied GLB. The first cache
attempt was blocked by Chrome's HTTPS-to-localhost permission; granting
`local-network-access` only in the isolated test context for the Pages origin
allowed both runs to pass. No deployed security setting was changed. A completed
direct upstream browser ONNX download is not claimed.

The mandatory deployment and published-origin checks are complete. Issue #13 was
updated with the actual results and closed as completed after both inference runs
passed; the verified-cache limitation above remains explicit.

No port 8765 service, unrelated Project, usage allowance, reset ticket, model or
provider was changed. Optional other-browser/device coverage remains unperformed.
