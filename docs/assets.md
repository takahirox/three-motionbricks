# Asset provenance and conversion

## Native SOMA body

The bundled `public/assets/soma.glb` is derived **only** from the native
`SOMA_template_rig.usda` at [nvidia/SOMA-X revision 32f0ab4](https://huggingface.co/nvidia/SOMA-X/tree/32f0ab4).
The [asset repository's model card](https://huggingface.co/nvidia/SOMA-X/blob/32f0ab4/README.md#licenseterms-of-use)
explicitly releases SOMA under Apache 2.0 and describes commercial use. This
license check applies to the actual native asset distribution, independently
of the SOMA-X Python code license. The original license is retained in
[licenses/SOMA-X-Apache-2.0.txt](../licenses/SOMA-X-Apache-2.0.txt).
No SMPL, SMPL-X, MHR, ANNY, MANO, external identity model, or motion sample is
included. Those backends have their own terms.

The bundled GLB SHA-256 is
`4255e39f5c3558e5f92a326f584290a4ea9f7529410571f38b380775e611b1d9`.
The USD source SHA-256 is
`a952cb7bdf4ccd801e355d53122d395b985b69d0d9181439edad5081bb171856`.
Reproduce the conversion from the repository root (Python 3.11+ and `uv`):

```sh
curl -fL 'https://huggingface.co/nvidia/SOMA-X/resolve/32f0ab4/SOMA_template_rig.usda' -o /tmp/SOMA_template_rig.usda
uv run --with numpy --with usd-core python scripts/convert-soma.py /tmp/SOMA_template_rig.usda public/assets/soma.glb
```

The converter reads the `c_skin_mid` native mesh, triangulates its faces,
computes smooth normals, scales centimeters to meters, and keeps Y up. It
preserves all 110 joints, parent relationships, local rest transforms and inverse
bind transforms. It strips floating-point noise from affine matrix components.
For Three.js skinning it selects the strongest four influences per vertex,
renormalizes them and zeros unused joint indices. The maximum discarded weight
at any vertex is approximately 0.16751; skinning is therefore an approximation
of the original multi-influence skin. The output has 18,056 vertices and 36,108
triangles. The neutral body surface is untextured. Conversion requires no CUDA,
Blender, proprietary identity backend or external animation clip.

At runtime a relaxed stance is authored by lowering the native T-pose's arms.
The 30 model joints drive the mesh in global orientation; the remaining fingers
and twist joints keep their local reference transforms. Native pose-dependent
surface correctives and procedural twist evaluation are outside this MVP.

## MotionBricks model

The downloader pins [NVlabs/motionbricks revision 54fc563](https://github.com/NVlabs/motionbricks/tree/54fc563aeaaf819a753d72cc9fdc6713989cdd43).
The official `motionbricks/assets/onnx/soma/mmm_v6_soma_fp32.onnx` is 757,864,273 bytes,
with SHA-256
`856419dc72aeb14e591eebf4dd0ea05734a2506ddb00bcd39dd6dac2ad60f4fb`.
`npm run assets:model` downloads the LFS payload directly, verifies its length and
hash, and writes it under `public/assets/`. An existing matching file is reused;
a mismatching existing file is never overwritten. Weights and partial downloads
are ignored by Git. The official batch-one manifest is bundled unchanged alongside the body under
the upstream asset CC-BY-4.0 terms; see [notices](../THIRD_PARTY_NOTICES.md).

The pretrained weights use the
[NVIDIA Open Model Agreement](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/motionbricks/assets/onnx/LICENSE.md),
not the code's Apache license. Obtain and use them under those terms. This
repository does not redistribute weights. Development loads the locally downloaded
file; production loads the same pinned upstream URL from [model-source.json](../model-source.json).
Production builds exclude weights even if installed locally. The demo makes no
inference requests to an external service.

MotionBricks' Bones-derived BVH clips have a separate
[sample data evaluation license](https://github.com/NVlabs/motionbricks/blob/54fc563aeaaf819a753d72cc9fdc6713989cdd43/assets/motions/LICENSE.txt).
The demo uses none of them. Its four-pose locomotion conditioning windows are
original authored stride poses, placed using root path, heading, velocity and height constraints. All
targets constrain the full body, with a relaxed standing stance for stopping.
These poses are never played as animation; only ONNX-generated motion is queued.
This replaces Scene Preview's clip-derived target blend spaces and may produce
less polished motion.

## Public hosting and caching

GitHub Pages hosts the app, worker, matching ORT WASM, native SOMA GLB, manifest,
and asset notices/licenses. `vite.config.ts` uses an explicit reviewed asset
allowlist rather than copying `public/` into production. Builds fail for unresolved
LFS pointers in those assets; `npm run check:pages` also scans the complete artifact
before upload. Do not add weights or other unreviewed/restricted assets to the
allowlist. SOMA needs no external textures or identity models.

The browser directly fetches the official FP32 weights at:

```text
https://media.githubusercontent.com/media/NVlabs/motionbricks/54fc563aeaaf819a753d72cc9fdc6713989cdd43/motionbricks/assets/onnx/soma/mmm_v6_soma_fp32.onnx
```

This is the **media payload**, not the GitHub HTML/raw Git LFS pointer. The model
terms remain the NVIDIA Open Model Agreement linked above; fetching directly does
not relicense it. Visitors see the size and terms before starting the download.
No evaluation-licensed motion data is fetched.

Availability/CORS check on 2026-10-31, with request header
`Origin: https://takahirox.github.io`: HEAD returned HTTP 200,
`Content-Length: 757864273`, `Content-Type: application/octet-stream`,
`Access-Control-Allow-Origin: *`, `Accept-Ranges: bytes`,
`Cache-Control: max-age=300`, and ETag matching the SHA-256 above. A ranged GET
returned HTTP 206 with `Content-Range: bytes 0-127/757864273`, the same CORS/cache
headers and binary ONNX data, not an LFS pointer. These are measured upstream
responses, not a hosting guarantee. Recheck after changing the source URL; the
production-preview real-model browser smoke also exercises an actual cross-origin
GET from a worker.

The first inference start transfers approximately 758 MB of weights, in addition
to the site's roughly 31 MB uncompressed total. Streaming reports progress and
checks the exact expected payload length before ORT loads the graph. The local
downloader additionally verifies SHA-256. Normal HTTP browser caching follows the
host's headers; large responses may not be retained, cache can be evicted, and
future visits can redownload all weights. There is no application-managed durable
model cache or offline guarantee. Do not rely on GitHub Pages serving this large
model, or on indefinite free upstream bandwidth. A host/network/CORS failure is
reported with retry and a link to local setup; there is no fallback inference
service. All runtime execution remains on the visitor's device.
