# Demo validation

## MVP validation for Issue #5

Validation performed on 2026-10-31. Source model and asset revisions, hashes and
licenses are in [assets.md](assets.md). The
[production browser report](validation-report.json) preserves the measured run.

### Environment and mandatory acceptance

Node 26.12.1, npm 11.20.0, Three.js 0.187.0, ONNX Runtime Web 1.31.1,
TypeScript 7.0.2, Vite 8.3.5, Playwright 1.64.1. The isolated headless system
Chrome reported version 156.0.0.0 on macOS, GPU vendor `apple`, architecture
`metal-3`, and buffer/storage-buffer limits of 4,294,967,292 bytes. The browser
smoke launches with `--enable-unsafe-webgpu` for headless testing. These results
establish this configuration, not universal browser/hardware compatibility.

| Check | Result |
| --- | --- |
| `npm test` | Pass: six input, pose/rotation, encoding, boundary decoding, stale queue/seam/underrun and asset tests; about 0.2 seconds total |
| `npm run build` | Pass: type check, worker bundling, local WASM and static asset output; Vite bundling about 0.6 seconds |
| `npm run test:browser` | Pass: skinned body/scene preview, walk/run key state, blur release, 390px layout, missing-model error, simulated unavailable-WebGPU error and WebGL-only preview |
| `npm run test:browser -- --model` | Pass in production preview: real official FP32 weights, successive walk/run/turn/stop generations, requested travel direction, upright torso and no page errors |
| Khronos glTF Validator | Pass: zero errors and zero warnings for the converted bundled GLB |
| Model SHA-256 | Matches the official Git LFS object; downloader reuses the verified local payload |
| `npm audit` | Zero known vulnerabilities in installed dependencies at validation time |
| Markdown links/anchors and `git diff --check` | Checked before commit |

The production browser test accepted 12 generations. The recorded maximum
change between displayed root samples was 0.09 meters; the final stopped
root moved approximately 0.014 meters over the last second. The smoke checks a
0.5-meter maximum displayed step and less than 0.25 meters of final stopped
travel; these detect obvious resets/teleports and failure to stop, not animation
polish or foot sliding. Each tested state also checks that the generated head
remains at least 0.25 meters above the root throughout the inspected segment;
the measured run segment minimum was 0.547 meters. Root traces confirmed −Z travel for W/Shift+W and +X
travel after changing to D. The native mesh was inspected in browser screenshots.

The production run loaded the session in 22.6 seconds, produced its first segment
in 185 ms, and then generated in 43–77 ms per request. An earlier development
run loaded in 2.1 seconds with a 191 ms first generation; a verbose cold check
took about 2.2 seconds for the first generation. Load and warm-up time vary
substantially with disk/browser/shader cache and memory pressure. These are
browser wall times including tensor transfer and dispatch, **not TensorRT
benchmarks**, GPU-only kernel times or a general performance guarantee.

The main JS bundle is about 920 kB before gzip; Vite reports its usual large
chunk warning. The worker uses a locally served ~28.7 MB Asyncify WASM payload.
The model is ~758 MB and is not part of Git. Total peak browser/GPU memory was
not measured. No external model conversion was needed to run inference.

### Operator support and the GPU-only blocker

The official opset-17 graph loads and runs unchanged with
`executionProviders: ['webgpu']`. In ORT 1.31.1 this permits its default WASM/CPU
provider for graph nodes not placed on WebGPU. A verbose session reported:

| Placement | Nodes after optimization |
| --- | ---: |
| WebGpuExecutionProvider | 2,165 |
| CPUExecutionProvider (WASM in the browser) | 1,231 |

GPU execution logs included Conv, MatMul, LayerNorm, attention-related operations
and activations. CPU-assigned operations included shape and index handling
(Gather, Shape, Unsqueeze, Concat, Range, Slice, Reshape), OneHot and
ScatterElements, and small arithmetic/casts. CPU placement does not by itself
mean an operator is unsupported; ORT also deliberately assigns shape computation
to CPU. This MVP does **not** claim a GPU-only graph.

Reproduce the GPU-only blocking condition:

1. Download the pinned model with `npm run assets:model` and start the demo.
2. Open `http://127.0.0.1:5173/?strictGpu=1` and start inference. This sets
   `session.disable_cpu_ep_fallback=1`.
3. Session creation fails: `This session contains graph nodes that are assigned
   to the default CPU EP, but fallback to CPU EP has been explicitly disabled
   by the user.` The UI records the failure and runs no motion.

`npm run test:browser -- --model --strict-gpu` asserts this explicit failure.
To inspect placement, use `?ortVerbose=1` (or combine query parameters). This
produces extensive runtime console output; keep it disabled for normal use and
latency measurements. A future requirement for GPU-only execution would need
ORT/operator support or a separately validated graph rewrite. No such rewrite
or unsupported-operator substitution is hidden in this implementation.

The WebGPU package at ORT 1.31.1 uses `ort-wasm-simd-threaded.asyncify.wasm`.
Pairing it with the older JSEP WASM produces a runtime initialization error;
the worker explicitly imports the matching package-exported Asyncify artifact.
No CDN, COOP/COEP headers or WASM multithreading are required (one WASM thread).

### Optional validation and remaining limits

Other desktop GPUs, Chrome/Edge releases, Safari and Firefox are untested.
Additional visual motion-quality review and lower-memory device measurements
are useful but not required post-merge work. The controls/camera are usable on a
narrow layout, but mobile inference and touch movement controls are out of scope.
The body's four-influence approximation and reference fingers/twists are
explained in [assets.md](assets.md). The model chooses the intermediate gait
from root and authored body-pose constraints; these replace the official
clip-derived target blend space.
Foot IK, exact speed tracking and production animation polish are not provided.

Required post-merge verification for Issue #5: **None required**.

## Pages deployment validation for Issue #7

Validation on 2026-10-31 uses the same Node 26.12.1 / npm 11.20.0 and isolated
system Chrome 156 / Apple Metal environment described above. The workflow selects
Node 24; hosted Actions execution is pending until the change reaches `main`.

| Pre-merge check | Result |
| --- | --- |
| `npm ci` | Pass; lockfile install, zero reported vulnerabilities |
| `npm test` | Pass: all six existing regressions plus a fast worker/timer test proving progress does not prematurely resolve loading, active transfers can exceed 15 minutes, idle loads fail, and inference retains its shorter timeout |
| `npm run build` | Pass: types and production bundling; existing large-JS-chunk warning remains |
| `npm run check:pages` | Pass: ten files, 31.2 MB uncompressed, local WASM/body/manifest/notices/licenses present, correct HTML base, no weights or LFS pointers |
| Build with local model/partial-file probes | Pass: even ignored ONNX/LFS-pointer and partial-download files in `public/assets/` stay out of production |
| Artifact guard negative probes | Pass: rejects an injected ONNX file and an unresolved LFS pointer in `dist/` |
| Workflow validation | YAML parsed with Ruby/Psych; manually reviewed action inputs, current official action releases, main/manual triggers, job permissions, artifact path, deployment dependency, environment and serialized concurrency |
| Browser smoke in development and `/three-motionbricks/` production preview | Pass: character/rendering, input/blur, narrow layout, no initial HTTP errors, production remote-model URL, missing model HTTP 404, LFS-pointer payload, failed network request, missing character, unavailable-WebGPU message and WebGL preview |
| Remote hosting | Pass: pinned media payload HEAD 200 and ranged GET 206 with exact length, binary prefix and `Access-Control-Allow-Origin: *` for the public Pages origin; see [hosting evidence](assets.md#public-hosting-and-caching) |
| Production-preview `test:browser -- --model` | Pass with the revised smoke: direct pinned remote-model download, WebGPU session creation and keyboard walk/run/turn/stop at `/three-motionbricks/`; 13 generations, no page errors. See the [remote-model report](pages-validation-report.json). |

The full remote-model rerun used a fresh isolated Chrome with the production
preview at `http://127.0.0.1:4173/three-motionbricks/`. Download plus session
creation took 3,932,888 ms (65 minutes 33 seconds). The first motion generation
took 186 ms; later requests took 44–59 ms. W and Shift+W traveled toward −Z,
D changed travel toward +X, and releasing the keys stopped motion. The measured
maximum displayed root step was 0.091 meters, final stopped travel was 0.010
meters over the last second, and the minimum inspected head height above the
root was 0.547 meters. The final screenshot showed the upright SOMA character.

The smoke now allows loading to continue while its status advances, with a
15½-minute idle watchdog instead of a fixed total deadline. It logs progress
every 30 seconds and writes `.artifacts/loading.json`; the committed report
retains ten-minute samples and each movement result. This run crossed the old
930-second limit while downloading and completed successfully. Its load time
includes the slow upstream transfer and is not an inference-speed measurement.

The production build always excludes local weights and uses the pinned remote
model. This supersedes the local-model production-build behavior measured for
Issue #5 above. The page discloses the 758 MB download, links the model terms,
reports download/compilation progress, and allows retry on loading/inference
failures. Browser checks are intentionally local validation, not part of the
lightweight deployment pipeline.

Required post-merge verification: **pending**. Configure the repository's Pages
source as **GitHub Actions**, verify the `main` deployment succeeds and the public
HTTPS URL serves all resources, then repeat inference/keyboard and graceful
failure checks on the published origin as described in the
[README](../README.md#github-pages-deployment). No workflow was dispatched and
no repository setting was changed during implementation.
