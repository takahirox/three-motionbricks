# Third-party notices

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
