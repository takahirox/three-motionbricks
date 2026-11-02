# three-motionbricks

A browser demo of a native, skinned SOMA humanoid controlled with the keyboard.
MotionBricks generates each motion segment locally with ONNX Runtime Web's
WebGPU provider. Three.js renders the character, ground and follow/orbit camera.
The **Character** selector automatically loads **MMD (Animasa Miku)** or
**MMD (CG-CA Uka)**, with toon/outline rendering and MMD rigid-body physics driven
by the same generated SOMA motion. Animasa is the exact pinned stock model;
its eye and toon textures are embedded in the GLB. No local upload is needed.
Animasa uses an isolated [Toon shading compatibility adapter](docs/animasa-shading.md)
with reference captures and numeric validation; Uka keeps the default renderer.
An optional verified local override remains available. See [Animasa source,
conversion and runtime](docs/animasa.md), the [maintainer's Issue #13 decision](docs/animasa-publication.md)
and [original notices and conditions](public/assets/animasa/README.md).
See [MMD retargeting and validation](docs/mmd.md) for the separate Uka integration.

**Public demo:** [takahirox.github.io/three-motionbricks](https://takahirox.github.io/three-motionbricks/)
(available after the first successful Pages deployment). No installation or backend
is required. Select **Start local inference** to download the 758 MB model from
the pinned upstream host and run it on your device. Review the model terms linked
in the page before starting; use a desktop WebGPU browser with enough memory.

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
stance drift and imperfect stops/turns remain possible. These native SOMA limits
do not describe Uka's separate sleeve IK and secondary physics. See
[implementation validation and compatibility](docs/validation.md).

## Build and checks

```sh
npm test
npm run build
npm run preview
```

Production builds use `/three-motionbricks/` as the base path and fetch the model
remotely, even if a local model is installed. Only the reviewed SOMA, Uka and
exact Animasa GLBs and their notices/licenses are published. Source models, loose textures, arbitrary local
assets, weights and partial downloads are excluded.
`npm run preview` serves the build at `http://127.0.0.1:4173/three-motionbricks/`.
Run `npm run check:pages` to check the artifact for missing resources, incorrect
HTML base paths, weights and unresolved Git LFS pointers.
The upload-directory check also rejects unreviewed textures, conversion records
and renamed GLBs independently of Vite's build allowlist.

Start the development or preview server before running browser smoke checks:

```sh
npx playwright install chromium
npm run test:browser
npm run test:browser -- --model
npm run test:browser -- --model --mmd
npm run test:browser -- --animasa
npm run test:browser -- --model --animasa
npm run check:mmd-ik -- --animasa
npm run check:mmd-ik
```

The first browser check covers rendering, keyboard/blur, narrow layout and the
missing-model, network, Git LFS pointer, missing-character and unavailable-WebGPU
errors. The second runs the official model through walk, run, turn
and stop over successive generations. To use an installed Chrome, set
`CHROME_BIN` to its executable. `DEMO_URL` selects another local server, such as
`http://127.0.0.1:4173/three-motionbricks/` for a production preview (which tests
the actual remote download and CORS). The real-model check allows slow downloads
while progress continues, with a 15½-minute watchdog for an unchanged loading
status. It logs progress every 30 seconds and saves a `loading.json` timeline
alongside reports/screenshots in ignored `.artifacts/`.
For repeated GPU checks, `MODEL_CACHE=/path/to/mmm_v6_soma_fp32.onnx` streams
a size/SHA-256-verified local copy through a test-only redirect. This avoids
repeated downloads and does not change the production app. Omit `MODEL_CACHE`
when validating actual upstream delivery or the published origin.
Browser tests require actual browser/GPU support and
are separate from the fast math/queue/asset tests.
MMD checks also verify visible physics response, resource cleanup, rapid model
switching and missing/corrupted GLB and missing Ammo recovery. `--animasa` tests
automatic Animasa selection, original-notice/asset hashes and the optional local
override. `--model --mmd` captures generated poses
for the offline IK comparison only in ignored `.artifacts/`. Recreate the committed
Uka GLB and local Ammo runtime with `npm run assets:mmd`; ordinary builds do not
download source assets.

## GitHub Pages deployment

One-time repository setup: in **Settings → Pages → Build and deployment**, choose
**Source: GitHub Actions**. GitHub Actions must be enabled for this repository.
If the `github-pages` environment has branch restrictions, allow `main`.
No model upload, Git LFS setup, backend, custom headers or repository secret is
needed.

[deploy-pages.yml](.github/workflows/deploy-pages.yml) runs build/tests/artifact checks for PRs targeting `main`, and
deploys on every push to `main`.
To redeploy manually, use **Actions → Deploy demo to GitHub Pages → Run workflow**
with branch `main`; other branches are skipped. The build job uses Node 24,
`npm ci` with npm download caching, `npm test`, `npm run build` and
`npm run check:pages`, then uploads **only `dist/`** with the official
`upload-pages-artifact` action. A dependent job runs `configure-pages` and
`deploy-pages` in the `github-pages` environment. Build access is `contents: read`;
only deployment gets `pages: write` and `id-token: write`. One deployment runs at
a time, allowing the active deployment to finish and retaining the latest waiting
revision. See [GitHub's custom workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

The static site is about 44 MB before compression, including the 1.34 MB native
SOMA GLB, 9.61 MB Uka GLB, 1.22 MB Animasa GLB, 1.88 MB Ammo runtime and 28.75 MB ORT WASM.
The selected MMD GLB and Ammo load on character selection. The **757,864,273-byte model (758 MB / 723 MiB)**
is downloaded separately from NVIDIA's pinned GitHub media/LFS payload URL only
when inference starts. It is never uploaded to Pages. This endpoint was checked
for payload availability and permissive CORS; hosting evidence, licenses and
caching details are in [assets.md](docs/assets.md#public-hosting-and-caching).
Upstream availability/bandwidth is outside this repository's control. HTTP caching
is temporary (currently five minutes); no durable model cache is promised, so a
later visit may download the entire model again. First load also compiles GPU
kernels and requires several GB of browser/GPU memory. Download progress and
actionable host/WebGPU/inference errors appear in the panel. Loading fails after
15 minutes without download progress (including compilation) and can be retried;
an active slow transfer can continue longer. Inference stays entirely in the browser.

Required post-merge verification for Issue #7 (pending until published): confirm
the `main` workflow succeeds, open the public HTTPS URL, and check that JS, CSS,
worker, WASM and character assets load without 404s. Start inference on a supported
WebGPU device to verify the remote model download and keyboard walk/run/turn/stop.
Also confirm a browser without WebGPU shows the explicit support message, and
blocking the model request shows a useful error with retry. A local preview check
does not establish that GitHub Pages has been configured or deployed successfully.

Required post-merge verification for Issue #13 remains pending: verify successful
Pages deployment and automatic exact Animasa loading, file hashes/notices/network
responses, real MotionBricks walk/run/turn/stop, physics, switching/error recovery
and SOMA/Uka regressions at the public URL. Keep Issue #13 open until those checks
succeed. A local production-prefix check does not establish published-origin success.

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
