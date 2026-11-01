# Animasa Hatsune Miku — local implementation (#11)

**Status: local-only interim implementation; public asset redistribution remains
blocked and is tracked separately in Issue #13.** The Character selector offers **MMD
(Animasa Miku)**, **SOMA**, and separately **MMD (CG-CA Uka)**. Choosing Animasa
asks for a locally converted GLB. No Miku model is shipped, fetched at runtime,
uploaded by the file picker, or copied into the Pages artifact. Uka does not
satisfy the Animasa requirement.

See the [Issue #13 rights reassessment and public-delivery plan](animasa-publication.md)
for the creator's interview, supporting stock-model evidence, explicit decision
and remaining distribution scope. The local implementation is complete; public
delivery is a separate prerequisite and deliverable.

## Verified source and rights investigation

Inspected 2026-11-01. The exact asset is
[`miku_v2.pmd` at Three.js r87](https://github.com/mrdoob/three.js/blob/5ce11d18c400791da0c9fbb4b6b9fcde2f754443/examples/models/mmd/miku/miku_v2.pmd).
The annotated r87 tag resolves to commit
`5ce11d18c400791da0c9fbb4b6b9fcde2f754443`. Its Git blob is
`5c88504144bd180083a7c5dce0b67d0fdb2f1a61`; size 712,126 bytes;
SHA-256 `45a5a2fb897266a1b371b30cf53ed9435d375ddea9fce7f095bba2739b9bdae5`.
Both Japanese and English PMD headers identify Hatsune Miku ver.2.3, physics
support, modeling/conversion by Animasa (あにまさ), and Crypton Future Media.
The [reference loader manifest](https://github.com/takahirox/three-mmd-loader/blob/main/examples/assets-manifest.json)
pins the same PMD blob and eye texture blob to Three.js commit
`2898f5b1ba10b1e94174c0a62d072f5f7b80442c`.
The [historical interactive application](https://github.com/takahirox/MMDLoader-app/blob/master/app_interactive.html)
uses this r87 asset. These establish identity and prior use, not a new license.

[`scripts/animasa-manifest.json`](../scripts/animasa-manifest.json) records exact
sizes and SHA-256 for every input: PMD, `eyeM2.bmp`, both model/distributor
readmes, the directory MMD notice, and the r87 loader containing shared toon
images. Only stock toon01/02/03 are referenced; there are no sphere maps or
external rig/physics resources. Skeleton, weights, morphs, bodies and joints are
inside PMD. All these inputs are checked before conversion, with no downloads.

Reviewed rights evidence:

- The complete [model readme](https://github.com/mrdoob/three.js/blob/r87/examples/models/mmd/miku/readme.txt)
  identifies an MMD-bundled model and points to the complete [MMD 5.24 readme](https://github.com/mrdoob/three.js/blob/r87/examples/models/mmd/miku/readme_miku_v2.txt).
  The latter permits image/video and PMM/VPD/VMD publication, and discusses
  including custom toon textures when publishing a model. It does not provide
  a model-author grant for redistributing this converted model.
- The complete [Three.js MMD directory notice](https://github.com/mrdoob/three.js/blob/r87/examples/models/mmd/Readme.txt)
  expressly excludes assets from MIT, refers to original archive/author terms,
  and directs users not to assume permissions for unmentioned uses.
- Following the [original distributor's site](https://sites.google.com/view/vpvp/),
  the MMD 9.32 x64 archive was also inspected (SHA-256
  `7edccd3a29fae3bfd217b2e75e526d13ac844828c7dbc927e959e3eecee29874`).
  Its complete UTF-8/BOM readme (70,441 bytes; SHA-256
  `06259ea1336196c6d25314066a9b05c5d9f022db59ecb648c5e55524643ba5cd`)
  permits use of the tool/formats in other software, while directing users to
  character rights holders. That is distinct from a model redistribution grant.
- [Crypton's character guidelines](https://piapro.jp/license/character_guideline)
  discuss free noncommercial 3DCG distribution with downstream guideline
  obligations. [PCL article 3](https://piapro.jp/license/pcl) also requires
  respecting third-party rights. The [English creator guidance](https://piapro.net/intl/en_for_creators.html)
  explicitly distinguishes original illustrations' CC license from existing 3DCG
  creators' copyrights. This model must not be labeled CC BY-NC on that basis.
- [MMD for Unity's own notice](https://mmd-for-unity-proj.github.io/mmd-for-unity/readme.html)
  reports Animasa permission for its included models. That is evidence of a
  permission given to another project; no transferable grant to this repository
  for this exact converted GLB was established.

**Current distribution assessment:** the later first-person interview and stock
model evidence support a favorable interpretation, but the Issue's required
attributable grant to modify and redistribute the stock model/resources is still
unconfirmed. No texture-specific or GLB/Pages-specific prohibition was found.
The [dated reassessment](animasa-publication.md) supersedes the earlier request
for a generic permission record and identifies the narrow scope and sufficient
evidence without requiring a separate license per texture or format. No rights
holder was contacted and no publication was performed.

## Offline local conversion

Use only a copy you may legally acquire and convert. Review all original terms
and Crypton's guidelines. Arrange the pinned files in a local source directory:

```text
source-root/
  Readme.txt
  MMDLoader.js
  miku/
    miku_v2.pmd
    eyeM2.bmp
    readme.txt
    readme_miku_v2.txt
```

The first file and `miku/` files are under `examples/models/mmd/` at the pinned
Three.js commit above. `MMDLoader.js` is `examples/js/loaders/MMDLoader.js` at
that same commit. Preserve exact source bytes, including notice encodings.
The manifest provides hashes and the loader's repository path. Acquire these
separately after reviewing the terms; the converter performs no network access.

```sh
npm ci
npm run assets:animasa -- /path/to/source-root
npm run dev
```

Select **MMD (Animasa Miku)** and choose `.cache/animasa-local/model.glb`.
The browser checks the exact deterministic GLB hash before GLTFLoader parses it.
Files remain on the device. Switch back to SOMA or Uka normally; a supplied File
is retained in memory for switching during the session. To replace an invalid
file, use the still-visible file picker. Reloading requires choosing it again.
Physics, inference, keyboard controls, error recovery and disposal use the same
runtime as the other characters. There is no runtime PMD/PMX support or VMD.

An optional output argument must point below ignored `.cache/`. The converter
also writes `conversion.json` with source pins, output hash and diagnostics, and
copies all three original text notices unchanged into `notices/`.
Do not commit or publish these artifacts. Vite's production allowlist excludes
them, and Pages checks permit only the reviewed SOMA and Uka GLBs. Local file
selection also works from a production preview without serving the Miku GLB.

## Conversion and runtime contract

The PMD-aware adapter feeds typed records into pinned
`mmd-gltf@3dfa726aa38992a1f7d5ea17b377c685e839e8b8`; it does not pretend PMD
bytes are PMX. It preserves 12,354 vertices, 22,961 triangles, BDEF2 weights,
140 bone identities/parents and inverse binds, 17 materials, 30 expression
POSITION targets, seven IK chains, eight eye/twist rotation grants, four twist
axes, 45 rigid bodies and 27 spring joints. The base morph is an index table,
not an expression; expression indices are remapped through it. Original PMD
bone records and physics records accompany converted metadata in extras.

PMD IK uses the reference loader's angle ×4 policy, capped at π (a CCD step
cannot exceed π), with an X-axis knee hinge. Original PMD records remain in
extras. Coordinates reflect Z/winding once in `mmd-parser@1.1.4`, then scale by 0.08
metres per unit. PMD bone-relative body positions become absolute for the
PMX-aware writer; joint frames use its normal conversion. PMD collision masks
are inclusion bits in the historical loader, so the adapter complements them
to PMX exclusion bits before the writer inverts them. The GLB therefore retains
the source inclusion masks (head: 65535, right hair: 65527), avoiding unintended
hair self-collision. Six
angular damping values above 1 clamp to 1, matching Bullet's `setDamping`;
original values remain in `pmdPhysics`. `eyeM2.bmp` is decoded losslessly from
BGR to PNG without guessed transparency. Three.js's three actual stock toon
PNG ramps are embedded, rather than relying on missing shared textures. PMD
edge flags become outline material/vertex factors. All textures are embedded.
No raw source PMD or prerecorded animation is embedded.

GLTFLoader registers toon, outline and physics plugins. BDEF needs no SDEF/QDEF
plugin; expressions stay at rest for locomotion and their GPU attributes are
omitted as for Uka, while all targets remain in the local GLB. The solver plugin
is included by the physics plugin. One incremental Bullet world owns stepping.

Animasa uses `ANIMASA_MAPPING` in `src/retarget.ts`: Hips→下半身,
Chest→上半身, Neck2→首, Head→頭, and the original shoulder/arm/elbow/wrist,
leg/knee/ankle/toe bones for both sides. Uka's nonexistent 上半身M/上半身2 are
excluded. World bind-axis correction handles the A-pose and intermediary twists;
hand direction uses 中指１ and ankle direction uses つま先. センター places
下半身 at the target hip; horizontal displacement stays in metres and vertical
displacement scales by bind hip heights. The same MotionPlayer's generated SOMA
pose drives both characters; no motion replacement is introduced.

The serialized source constraints stay intact. The cloned Animasa runtime solver
orders dependencies by parent/grant/IK links because PMD has no PMX deformation
layers. Four undriven fixed-axis twists keep local rest, as in the existing Uka
approximation, since the upstream executor cannot evaluate fixed axes. Eight eye
and twist grants remain active. The three necktie/hair IK chains overlap dynamic
physics writers, so those records are omitted only from the runtime clone to
avoid competing writers (including when physics is off). Four leg/toe chains are
retained; FK is the default. On the captured live walk/run/turn/stop frames,
source-position-driven ankle/toe IK displaced foot joints by 5.4–7.6 cm on
average (up to 10.5 cm) and increased maximum sampled foot travel in all states.
During stop, minimum joint height fell from +1.5 cm (FK) to −2.0 cm (IK). Both
strategies dipped below ground while moving (FK down to −2.0 cm, IK −3.1 cm).
Leg/toe IK stays off to avoid fighting generated FK; this does not provide foot
locking or eliminate sliding. Measurements are in `animasa-validation.json`.
No claim of complete original-MMD fidelity is made.

## Validation

Fast default checks reject wrong source and output identities. Exact-asset checks
are opt-in so third-party assets never become test fixtures in Git:

```sh
ANIMASA_SOURCE=/path/to/source-root npx tsx --test tests/animasa.test.ts
ANIMASA_GLB=.cache/animasa-local/model.glb npm run test:browser
ANIMASA_GLB=.cache/animasa-local/model.glb npm run test:browser -- --model
npm run check:mmd-ik -- --animasa .artifacts/mmd-movement.json
npm test
npm run build
npm run check:pages
```

Use `CHROME_BIN` for an installed supported browser. The exact-asset integration
check verifies deterministic bytes, preserved skin/identity/morphs/constraints,
all 45 collision groups and inclusion masks against untouched source records,
finite retargeted poses, independent hair/skirt physics, fixed-step counts,
physics-off behavior and native cleanup. Browser checks verify shaders/appearance,
visible physics, local selection, rapid switching and retry. Real-model checks
exercise walk/run/turn/stop and switching while inference continues. Generated
traces, screenshots, source assets and GLBs remain ignored.

Public redistribution and a published-origin Miku check remain blocked on the
specific rights evidence above. A local preview does not establish publication
success. See `animasa-validation.json` for checks actually run and their limits.
