# Third-party notices

- `public/assets/uka/model.glb`: CG-CA Uka (c) 2023-2024 by Nagoya Institute of
  Technology, Moonshot R&D Goal 1 Avatar Symbiotic Society. CC BY 4.0. Converted
  from `mmdagent-ex/uka@659f0d1a740fec68bb2817dc9c694a35e7a15f12` PMX to skinned
  glTF, with textures resized to at most 1024 pixels; morphs and MMD extension
  metadata retained as described in [the conversion record](docs/mmd.md).
  Full original [English](public/assets/uka/README.md) and
  [Japanese](public/assets/uka/README.ja.md) notices/guidelines accompany the asset.
  No endorsement is implied. These assets are not licensed as repository code.
- MMD conversion, material/outline plugins, solver and physics runtime:
  [takahirox/mmd-gltf](https://github.com/takahirox/mmd-gltf/tree/3dfa726aa38992a1f7d5ea17b377c685e839e8b8),
  pinned to the integration revision above; upstream source is
  unmodified. Its archive has no root code-license declaration; no additional
  license or general relicensing grant is asserted here.
- `public/runtime/ammo.js`: unmodified Ammo.js resource from
  `ammojs-typed@1.0.6`, Copyright (c) 2011 ammo.js contributors, under the retained
  [backend license](public/runtime/ammo-LICENSE). The npm wrapper's package license
  does not replace that resource's notice. See [runtime pin/hash](docs/mmd.md).

- `public/assets/soma.glb`: native SOMA-X template mesh and rig, Copyright NVIDIA
  CORPORATION & AFFILIATES. Converted from `nvidia/SOMA-X` asset revision
  `32f0ab4`, Apache-2.0. See [asset provenance](docs/assets.md) for modifications
  and [the original license](licenses/SOMA-X-Apache-2.0.txt).
- `public/assets/soma_n1.json`: NVIDIA MotionBricks SOMA manifest, Copyright (c)
  2026 NVIDIA CORPORATION & AFFILIATES, CC-BY-4.0 (assets), under the upstream
  [combined license](licenses/MotionBricks-LICENSE.txt). The manifest is unchanged.
- The pose feature encoding, 6D decoding, boundary trimming, heading alignment,
  target placement and endpoint correction in `src/motion.ts` and `src/player.ts`
  adapt the algorithms in NVIDIA MotionBricks revision
  `54fc563aeaaf819a753d72cc9fdc6713989cdd43`, including
  `motionbricks/model/soma/kernels.py`, `motionbricks/runtime/target_pose.py`,
  `motionbricks/runtime/motion_player.py`, and `docs/examples/locomotion_loop.py`.
  Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES, Apache-2.0. The port uses
  Three.js transforms, original authored stride targets, an asynchronous browser worker,
  and a bounded segment queue in place of Warp/TensorRT and clip blend spaces.
  See [the original license](licenses/MotionBricks-LICENSE.txt).
- Three.js, ONNX Runtime Web, and development dependencies retain their package
  licenses, installed in `node_modules/`. No MotionBricks pretrained weights or
  evaluation-licensed motion clips are committed.
