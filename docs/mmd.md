# MMD character integration (Issues #9 and #11)

The Character selector defaults to SOMA and offers **MMD (Animasa Miku)** via
user-supplied local GLB, and separately **MMD (CG-CA Uka)**. Both consume the same
continuously generated MotionBricks SOMA poses. See [the Animasa implementation,
exact source manifest, rights investigation and local conversion](animasa.md).
Uka is an optional model and does not complete the Animasa request in Issue #11.
The remaining sections describe the existing Uka pipeline unless specified.

## Animasa Miku provenance and redistribution blocker

Inspected on 2026-11-01:

- The [historical application](https://github.com/takahirox/MMDLoader-app/blob/master/app_interactive.html)
  references Three.js r87's `examples/models/mmd/miku/miku_v2.pmd`.
- That [PMD](https://github.com/mrdoob/three.js/blob/r87/examples/models/mmd/miku/miku_v2.pmd)
  is 712,126 bytes (Git blob `5c88504144bd180083a7c5dce0b67d0fdb2f1a61`).
  Its Shift_JIS header describes a physics-enabled Hatsune Miku PolyMo model
  ver.2.3, credits **あにまさ氏** for modeling and data conversion, and credits
  Crypton Future Media for copyright. This verifies Animasa identity.
- The [asset-specific readme](https://github.com/mrdoob/three.js/blob/r87/examples/models/mmd/miku/readme.txt)
  identifies a model bundled with MMD. Its [MMD 5.24 readme](https://github.com/mrdoob/three.js/blob/r87/examples/models/mmd/miku/readme_miku_v2.txt)
  permits publishing images/video and PMM/VPD/VMD files; it does not establish
  permission to redistribute the model as a converted GLB. That readme is UTF-8.
- Three.js's [MMD notice](https://github.com/mrdoob/three.js/blob/r87/examples/models/mmd/Readme.txt)
  excludes these assets from MIT and requires the original archive's individual
  terms. Inclusion in an example repository is not permission to republish.
- Crypton's [character guidelines](https://piapro.jp/license/character_guideline)
  address free noncommercial 3D model distribution and require recipients to
  follow those guidelines. The [English creator guidance](https://piapro.net/intl/en_for_creators.html)
  and [Piapro Character License](https://piapro.jp/license/pcl) do not replace
  an independent model author's terms.

**Current bundling decision (#13):** the creator's directly attributable
interview and stock-model reports support free reuse, but leave an inference
about distribution of the model and accompanying resources. The Issue's explicit
rights prerequisite remains unmet. See the [dated evidence assessment, narrow
remaining scope and delivery plan](animasa-publication.md). No model-specific
GLB/Pages or texture prohibition was found; no Miku asset or runtime download
is included.

Issue #11 adds a deterministic offline PMD-aware adapter and local GLB file
selection without bundling or downloading Miku at runtime. The specific rights
blocker remains; see [Animasa source and conversion](animasa.md). The following
PMX conversion instructions apply to Uka.

## Selected licensed alternative

**CG-CA Uka** remains a separately named optional model from PR #10.
The author's [English](https://github.com/mmdagent-ex/uka/blob/659f0d1a740fec68bb2817dc9c694a35e7a15f12/README.md)
and [Japanese](https://github.com/mmdagent-ex/uka/blob/659f0d1a740fec68bb2817dc9c694a35e7a15f12/README.ja.md)
notices license repository files under **CC BY 4.0**, permit model modification,
and request the visible credit. Both full notices, including usage guidelines
and the derivative disclaimer, accompany the GLB unchanged. This attributed
technical demonstration and free public redistribution are within the reviewed
scope; no endorsement is implied. Guidelines prohibit harmful/deceptive uses
and infringement and must accompany reuse. Uka is independent of Crypton's
characters and does not require their character license.

Attribution: **CG-CA Uka (c) 2023-2024 by Nagoya Institute of Technology,
Moonshot R&D Goal 1 Avatar Symbiotic Society**.

## Reproducible offline conversion and deployment

```sh
npm ci
npm run assets:mmd
```

Generated assets are committed, so ordinary builds need no asset download.
The acquisition/conversion command downloads only missing files; a verified
`.cache/uka` works offline. It checks the pinned manifest's sizes and SHA-256
for the PMX, nine referenced PNGs and both notices, failing on any mismatch.
It acquires no VMDs or unused source resources.

The Issue's referenced `takahirox/mmd-gltf` converter/plugins are pinned to
`3dfa726aa38992a1f7d5ea17b377c685e839e8b8` through codeload and lockfile integrity.
No cross-repository change is required. All dependencies use the app's exact
Three.js 0.187.0 through an override, avoiding duplicate classes. `sharp@0.35.5`
resizes textures to at most 1024 pixels with alpha retained; this reduces detail.
`ammojs-typed@1.0.6` provides the self-contained classic Ammo JavaScript resource,
checked against SHA-256
`422b87333fec6272a592088f96bd672dc8f62b9649b12d44e493fd427e89fff8`.

Conversion uses `mode:'bdef'`, `scale:0.08` metres per PMX unit, and
`physics:'rigid-body-v1'`. The parser reflects Z and triangle winding once;
output is right-handed, Y-up. There is no additional runtime reflection.
All **302 bones**, hierarchy, inverse binds and exact `pmxBone.index/name`
identity are retained. Uka uses BDEF1/2 (21,434 / 28,521 vertices), so core
glTF skinning preserves those weights. SDEF/QDEF plugins are unnecessary for
this source; another profile must assess/register them explicitly.

The GLB retains 203 supported vertex/group POSITION targets, bone-morph metadata,
toon/outline material extensions, ordered solver metadata, and all **164 rigid
bodies / 151 spring joints**. Sparse target serialization preserves deltas.
The converter's embedded raw PMX copy is removed; relevant skin, morph, material,
solver and physics metadata remain. Material morphs and material-dependent groups
do not execute and are reported. Locomotion keeps facial expression at rest;
the preview omits the retained morph GPU attributes to avoid allocating 203
full-surface layers. The downloadable GLB still contains its supported targets.

`public/assets/uka/conversion.json` records pins, hashes, changes and diagnostics.
The explicit build allowlist publishes only the GLB, notices/record, and required
runtime/license. Pages checks reject PMD, PMX, VMD, weights and partial files.
All URLs use `BASE_URL`, including `runtime/ammo.js`; there is no Ammo worker,
CDN or WASM sidecar. Existing ORT worker/WASM paths are unchanged.

## Retargeting contract

`src/retarget.ts` binds by exact retained names, rejecting missing/duplicate
names. Its mapping/root profile supports additional compatible models. Loader
display-name sanitization and source-index order do not affect binding.

| SOMA joint | Uka driving bone |
| --- | --- |
| Hips | 下半身 |
| Spine1 / Spine2 / Chest | 上半身 / 上半身M / 上半身2 |
| Neck2 / Head | 首 / 頭 |
| Left/RightShoulder | 左/右肩 |
| Left/RightArm | 左/右腕 |
| Left/RightForeArm | 左/右ひじ |
| Left/RightHand | 左/右手首 |
| Left/RightLeg | 左/右足 |
| Left/RightShin | 左/右ひざ |
| Left/RightFoot | 左/右足首 |
| Left/RightToeBase | 左/右つま先 |

Native bind rotations/positions are captured before the existing relaxed stance
is authored. Target world orientation is `sourcePoseWorld × inverse(sourceBindWorld)
× anatomicalAlignment × targetBindWorld`. Alignment is the shortest rotation
from the MMD bind limb segment to the SOMA bind segment, correcting Uka's A-pose
versus SOMA's T-pose. Hands use the middle-finger direction, feet the toe direction,
and torso/head their world bind frames. Writes use the actual target parent's
world frame in hierarchy order, including intermediary twist bones. Rest local
translations and unmapped bones reset before each pose to clear solver writes.

センター translates so 下半身 reaches the requested hip position. 全ての親 and
グルーブ remain at rest, preventing double root translation/heading. Horizontal
displacement remains in world metres, matching the existing player/camera/ground;
vertical displacement scales by the target/source bind hip-height ratio. Limbs
retain their lengths. There is no per-frame ground clamp that would snap the body.
Facing comes from global source rotations. Uka has the same forward convention;
another facing convention needs explicit calibration.

Jaw, eyes, extra neck joints, fingers and twist bones keep local reference TRS.
Four fixed-axis twist constraints are preserved in the asset but omitted from a
**cloned runtime solver profile** because the upstream executor rejects them.
Those undriven twists stay at local rest. This approximation is reported rather
than modifying serialized source constraints or claiming full MMD reproduction.

## Frame ownership, physics and experimental IK choice

One inference worker and MotionPlayer serve both characters. Per frame:

1. Advance/interpolate the existing player's actual generated SOMA pose.
2. Apply SOMA normally; retarget that same pose to MMD driving bones if selected.
3. Supply local TRS to the solver/physics adapter: six sleeve IK chains and two
   eye append grants run before physics. Leg/toe IK is off.
4. Step one persistent `PhysicsWorld` at the retained 1/120-second interval.
   Inputs interpolate across fixed ticks; catch-up is capped at 0.05 seconds.
   Each tick runs pre-solver → kinematic updates → Bullet → dynamic bone writes
   → post-solver once, with no animation mixer or second physics owner.
5. Write final local TRS, update world matrices, and render toon plus outline.

Mode-0 bodies follow animation. Modes 1/2 override only retained secondary bones;
a regression asserts none directly driven by the retargeter is a dynamic writer.
`MMDPhysicsPlugin` discovers metadata; the app uses incremental `PhysicsWorld`
instead of `PhysicsRig`'s reset/replay seek timeline, which is unsuitable for an
unbounded live stream. Physics off retains sleeve IK/append for fair comparison.

Switching releases Bullet handles, skeletons, geometry, materials, textures and
outline targets. Revision tokens dispose stale loads and ignore late failures.
Errors return to SOMA with a retryable message, preserving inference and controls.
Physics off, switching, pagehide and visibility changes reset/release worlds;
hidden tabs do not step. One Ammo module is reused, with instance-owned worlds.

**IK experiment:** run the real-model browser smoke with `--model --mmd`, then
`npm run check:mmd-ik`. The explicit `captureMotion` diagnostic query records
generated poses only in ignored test artifacts. The comparison enables all
leg/toe chains with ankle/toe controllers driven from SOMA foot positions relative
to the hip and scaled to MMD hip height; sleeves remain on. In recorded
walk/run/turn/stop samples, IK shifted ankle/toe joints by 6.6–8.1 cm on average,
produced negative joint heights in all four states, and slightly increased maximum
foot frame travel. FK kept sampled foot joints above ground. Leg/toe IK is
therefore off to avoid fighting generated FK. Sleeve IK stays on because Uka's
sleeves have separate bones. See [measurements](mmd-validation.json).

These measurements do not establish universal foot locking: source sliding,
different proportions and imperfect ground contact remain possible. Original-MMD
fidelity, full fixed-axis twist, material morphs and mobile inference are not
claimed. Tail, ears, hair and clothing use real retained rigid bodies/joints.

## Validation scope

Fast tests cover actual asset metadata, bind axes/parent frames, root/facing/scale,
clearing solver writes, dynamic ownership, step bounds, native cleanup and async
switching/retry. Browser checks exercise actual GLB/shaders/Ammo, scene-only pixel
differences with physics on/off, repeated switching, native allocation counts,
missing GLB/Ammo and retry, keyboard, narrow layout and WebGL rendering fallback.
Real-model checks verify walk/run/turn/stop and switching during active inference.

Mandatory pre-merge checks: unit tests, production build, Pages artifact checks,
production-prefix browser smoke and real-model locomotion. Optional: more devices
and subjective animation polish. Required post-merge verification for this change:
none. Deployment was not performed; existing Issue #7 deployment verification is
separate. Validation performed and practical limits are in the linked record.
