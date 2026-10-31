# MVP validation for Issue #5

Validation performed on 2026-10-31. Source model and asset revisions, hashes and
licenses are in [assets.md](assets.md). The
[production browser report](validation-report.json) preserves the measured run.

## Environment and mandatory acceptance

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

## Operator support and the GPU-only blocker

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

## Optional validation and remaining limits

Other desktop GPUs, Chrome/Edge releases, Safari and Firefox are untested.
Additional visual motion-quality review and lower-memory device measurements
are useful but not required post-merge work. The controls/camera are usable on a
narrow layout, but mobile inference and touch movement controls are out of scope.
The body's four-influence approximation and reference fingers/twists are
explained in [assets.md](assets.md). The model chooses the intermediate gait
from root and authored body-pose constraints; these replace the official
clip-derived target blend space.
Foot IK, exact speed tracking and production animation polish are not provided.

Required post-merge verification: **None required**.
