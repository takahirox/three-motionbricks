# three-motionbricks

A browser demo of a native, skinned SOMA humanoid controlled with the keyboard.
MotionBricks generates each motion segment locally with ONNX Runtime Web's
WebGPU provider. Three.js renders the character, ground and follow/orbit camera.

## Setup

Use Node.js 22.12+ (Node 24+ recommended), npm, and a desktop browser exposing a
WebGPU adapter on **localhost or HTTPS**. Chrome/Edge with hardware acceleration
are the first target; see [measured compatibility](docs/validation.md). Several
GB of available browser/GPU memory are advisable: the FP32 model alone is about
758 MB and session creation also needs WASM memory, activations and GPU buffers.

```sh
npm ci
npm run assets:model
npm run dev
```

Open the printed local URL and select **Start local inference**. Model loading,
shader compilation and the first generation take longer than warmed inference.
The native SOMA body is bundled legally under Apache 2.0; the pretrained model
is downloaded separately under NVIDIA's Open Model Agreement. See
[asset provenance, licenses and USD → GLB conversion](docs/assets.md).

The WebGPU provider uses CPU/WASM for some graph and unsupported operations.
This is disclosed in the demo and diagnostics; it is not a GPU-only graph.
If model loading or inference fails, the character holds its pose and the
panel shows the failure. There is no prerecorded animation or remote inference
fallback. Without WebGPU, the body may still preview through Three.js's WebGL
backend, but inference is blocked explicitly.

## Controls

| Input | Action |
| --- | --- |
| W / up arrow | Move toward world −Z |
| S / down arrow | Move toward world +Z |
| A / left arrow | Move toward world −X |
| D / right arrow | Move toward world +X |
| Hold Shift while moving | Run (4.5 m/s target; walk is 2.3 m/s) |
| Release movement keys | Generate a stop toward the standing stance |
| Drag / scroll | Orbit / zoom the camera |

Movement is world-relative and turns the character to face travel; diagonals
are normalized. Camera orbit does not change the movement axes. Blur or a hidden
tab clears held keys. Controls are ignored while a form control has keyboard
focus; click the scene to resume movement.

The panel shows movement intent, last inference latency, queued seconds,
generation count and root position. **Diagnostics → Save report** records runtime,
GPU limits, loading time, recent inference times and any error.

## Runtime

The four most recent poses form each context. Targets specify travel direction,
speed, heading and root height ahead of the queued endpoint. Four original
authored stride poses constrain the full body for walking/running; a relaxed
standing stance constrains stopping. These poses are conditioning inputs only;
the model generates all played movement. The adapter removes
the last context's ground position and aligns its heading to +X, encodes all
seven official SOMA tensors, and restores world placement after inference. It
decodes global 6D rotations, trims three boundary frames from each end, and
applies root translation plus parent-relative rotations to the native rig.

One worker runs inference without blocking the rendering thread. The player
requests ahead from a fixed queued endpoint, joins it with an eight-frame fading
start correction, and interpolates at display rate. Input changes retain up to
0.2 seconds of queued movement, invalidate older requests and generate a new
path from the retained history. An underrun holds the last pose instead of
extrapolating or teleporting; slow devices can therefore pause between segments.

Known MVP limits: targets use a small set of original authored stride poses
rather than the official Scene Preview clip blend spaces; fingers/twist joints retain reference
transforms; no foot IK, physics, pose correctives or mobile optimization. Sliding,
stance drift and imperfect stops/turns remain possible. See
[implementation validation and compatibility](docs/validation.md).

## Build and checks

```sh
npm test
npm run build
npm run preview
```

The production build includes the local model if downloaded. Start the server
before running the browser smoke checks:

```sh
npx playwright install chromium
npm run test:browser
npm run test:browser -- --model
```

The first browser check covers rendering, keyboard/blur, narrow layout and the
missing-model and unavailable-WebGPU errors. The second runs the official model through walk, run, turn
and stop over successive generations. To use an installed Chrome, set
`CHROME_BIN` to its executable. `DEMO_URL` selects another local server, such as
`http://127.0.0.1:4173/` for a production preview. Reports/screenshots are written
to ignored `.artifacts/`. Browser tests require actual browser/GPU support and
are separate from the fast math/queue/asset tests. No post-merge check is required.

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
