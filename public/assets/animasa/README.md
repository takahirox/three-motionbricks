# Animasa Hatsune Miku

Modeling and original data conversion: **Animasa (あにまさ)**.
Character **© Crypton Future Media, INC.** No endorsement implied.

## Maintainer decision and conditions

On 2026-11-01, the repository owner resolved the redistribution prerequisite in
[Issue #13](https://github.com/takahirox/three-motionbricks/issues/13) and authorized
conversion, inclusion and public distribution of this exact pinned stock model
and its required resources in this free public demo. This records a maintainer
decision; it does not assert a new third-party grant or relicense the assets.
Earlier rights-blocked preparation notes are superseded by that decision.

Preserve and review the original notices, copied without changes or transcoding:

- [Three.js MMD asset notice](notices/Readme.txt) (excludes these assets from MIT).
- [Model notice](notices/miku/readme.txt).
- [Original MMD readme](notices/miku/readme_miku_v2.txt).

Character use remains subject to the [Piapro Character License](https://piapro.jp/license/pcl)
and [Crypton character-use guidelines](https://piapro.jp/license/character_guideline).
Follow the original model/resource conditions and these character guidelines when
reusing the asset. Repository code licensing does not replace those conditions;
this asset is not labeled MIT, CC BY, CC BY-NC or public domain.

## Exact source and changes

Source: [Three.js r87, commit 5ce11d18c400791da0c9fbb4b6b9fcde2f754443](https://github.com/mrdoob/three.js/tree/5ce11d18c400791da0c9fbb4b6b9fcde2f754443/examples/models/mmd).
The model is `miku/miku_v2.pmd`, blob `5c88504144bd180083a7c5dce0b67d0fdb2f1a61`,
SHA-256 `45a5a2fb897266a1b371b30cf53ed9435d375ddea9fce7f095bba2739b9bdae5`.
[conversion.json](conversion.json) records all six input sizes/hashes, repository
paths, converter pin, output identity and diagnostics. Only `eyeM2.bmp` and
stock toon01/02/03 from that revision's MMDLoader are used, embedded as PNG images
inside `model.glb`. No external textures are needed at runtime.

Changes: PMD → right-handed skinned GLB at 0.08 metres per unit; original skin,
140 bone identities, 30 morph targets, toon/outline materials, seven IK chains,
eight grants, 45 rigid bodies and 27 spring joints retained. PMD-relative body
positions, collision inclusion masks and base-indexed morphs are normalized for
the PMX-aware converter; six angular damping values clamp to 1 as Bullet does.
Original bone and physics records remain in extras. No source PMD or VMD is
published. Runtime uses generated MotionBricks SOMA poses, FK legs/toes, retained
grants and secondary rigid-body physics; unsupported fixed-axis twists remain
at rest. The three overlapping hair/necktie IK chains are excluded only from the
runtime solver clone to avoid competing with physics. Full MMD fidelity and foot
locking are not claimed.

Published GLB: 1220308 bytes; SHA-256 `cc3bd0a0c5620a248dda1bbb8b7e2c97aab7c8d863ef9a6add817bd56311cc07`.
See [implementation and reproducible conversion](https://github.com/takahirox/three-motionbricks/blob/main/docs/animasa.md).
