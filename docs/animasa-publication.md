# Animasa public delivery — Issue #13

## Maintainer decision (2026-11-01)

The repository owner explicitly resolved the redistribution prerequisite for the
exact pinned Animasa stock model/resources and this free public demo in
[Issue #13](https://github.com/takahirox/three-motionbricks/issues/13).
Proceed with conversion, inclusion and public distribution. This updated Issue
supersedes older rights-blocked Issue comments, draft PR text and investigation
notes; no further generic rights confirmation is needed for this task.

This records a maintainer decision, not a newly obtained third-party license or
authorization document. Preserve original notices, source pins/hashes, author and
character credits, model/resource conditions, the Piapro Character License and
Crypton's character-use guidelines. Do not relabel the asset MIT, CC BY, CC BY-NC
or public domain. The decision applies to this exact stock model/resources and
this demo; it does not expand the asset set.

## Implemented delivery

The normal **MMD (Animasa Miku)** selection fetches
`BASE_URL + assets/animasa/model.glb`, verifies its size/SHA-256, then uses the
existing #11 GLTFLoader plugins, Animasa retargeting and physics profile. The
optional local override accepts exactly the same verified GLB and stays on the
device. Clear it to restore automatic loading. SOMA and Uka remain separate
choices, sharing the existing MotionPlayer and inference worker.

The GLB is reproduced from Three.js r87 commit
`5ce11d18c400791da0c9fbb4b6b9fcde2f754443` using the pinned offline converter.
Only the publication extras changed from #11; MMD toon/outline, solver, skin,
morph and physics metadata are preserved. All four required eye/toon images are
embedded; there are no runtime external texture requests or PMD/PMX downloads.
See [source pins and conversion](animasa.md) and the [published provenance,
original notices, conditions and output hash](../public/assets/animasa/README.md).

Vite's explicit copy list and the independent Pages artifact guard allow exactly:

- `assets/animasa/model.glb`
- `assets/animasa/conversion.json`
- `assets/animasa/README.md`
- `assets/animasa/notices/Readme.txt`
- `assets/animasa/notices/miku/readme.txt`
- `assets/animasa/notices/miku/readme_miku_v2.txt`

The artifact guard verifies sizes/SHA-256 from the reviewed publication manifest,
including unchanged original notice hashes. Source PMD, loader source, loose
textures, conversion scratch, arbitrary GLBs, weights and `.cache/` remain excluded.
All delivery is from the Pages origin, so no additional asset CORS configuration
is needed. The existing remote ONNX hosting remains unchanged.

The Pages workflow runs fast tests, build and artifact checks on PRs to `main`
as well as `main`; only `main` uploads/deploys the Pages artifact. No permissions
or upload path are broadened. Browser checks exercise automatic delivery and
asset/notice responses, optional override, corrupt/missing model and Ammo recovery,
visible physics, switching and actual-model inference.

## Acceptance and publication

Mandatory pre-merge checks include exact-source deterministic conversion and
retargeting/Bullet integration, fast tests, build, independent artifact checks,
production-prefix browser checks for both MMD characters and SOMA, real WebGPU
MotionBricks walk/run/turn/stop, physics, IK comparison, switching and recovery.
Review the final diff and actual published PR head's CI before marking PR #14
ready. Pending CI requires waiting; historical main-branch CI is not evidence
for this change. See [current validation and remaining checks](animasa-publication-validation.md).

Required post-merge verification remains pending: successful Pages deployment,
automatic exact-model loading, asset/notice hashes and network responses,
locomotion/physics/switching/recovery and SOMA/Uka regressions at
`https://takahirox.github.io/three-motionbricks/`. Keep Issue #13 open until those
checks succeed. Pre-merge local evidence cannot establish published-origin success.
More devices and subjective animation polish are optional.

## Historical evidence (prior preparation)

The following records the earlier investigation without repeating it. Its former
requirement for a further distribution-scope confirmation is superseded by the
maintainer decision above. These observations are historical context, not an
assertion of a new grant to this repository.

| Source | Evidence reviewed | Scope and limits |
| --- | --- | --- |
| [ASCII.jp, 2009-10-23, page 5](https://ascii.jp/elem/000/000/470/470260/5/) | Animasa answers a question about rights: 「自由にやってほしいですね。もともとそれが目的ですし。」 He describes his approach as close to relinquishing rights, without a formal waiver. | Directly attributable first-person support for free reuse. The surrounding discussion concerns MMD culture and works, including video/DVD sales; the answer does not expressly identify redistribution of editable models or textures. This is stronger evidence than silence or a community assertion, but not a complete statement of distribution terms. 2009-10-23 is the statement's publication date; no project-specific permission date is established. |
| [Same interview, page 2](https://ascii.jp/elem/000/000/470/470260/2/) | Identifies Animasa as the creator of MMD's bundled Miku. | Connects the speaker to the stock model, consistent with the pinned PMD header. It does not enumerate the resources he owns. |
| [Community model entry](https://mikumikudance.fandom.com/wiki/Miku_Hatsune_(Animasa)) and [MMD:Ethics](https://mikumikudance.fandom.com/wiki/MMD:Ethics) | The entry marks edits distributable and reports noncommercial use; Ethics reports explicit editing/redistribution permission for stock-model authors. | Supports the favorable interpretation. These are secondary reports without the underlying author's grant. The model entry labels ver.2.2, so it is not an independent byte-level identification of the pinned ver.2.3. |
| [Creator-permissions table](https://mikumikudance.fandom.com/wiki/MikuMikuDance_Wiki:Model_Creator_Permissions) and [Animasa page](https://mikumikudance.fandom.com/wiki/Animasa) | The maintainer reports edit/redistribution permission in the Issue. | Direct retrieval was unavailable during this review (robots denial and HTTP 402, respectively). Their reported content is retained as supporting evidence, not presented as independently inspected original terms. No paid access was purchased. |
| [MMD for Unity notice](https://mmd-for-unity-proj.github.io/mmd-for-unity/readme.html), model-use section | The project reports Animasa's permission for unrestricted use of its bundled model data and describes conversion into Unity assets. | First-party report of cross-engine permission for that project. It supports feasibility but does not say that permission transfers to this repository. Its code license does not replace the model terms. |
| [Crypton character guidelines](https://piapro.jp/license/character_guideline), A.1–A.3 and D.1–D.2; [PCL](https://piapro.jp/license/pcl), articles 3–4 | Provides a route for free noncommercial character derivatives and 3DCG model distribution, subject to conditions and downstream guideline notices. | Supplies character-side permission within that scope; article 3 also requires respecting others' rights. No new Crypton permission is identified as necessary for this individual hobby demo if it remains within that scope. Corporate use, advertising/promotional use and larger noncommercial use have separate conditions in D.2. |
| [Pinned directory notice](https://github.com/mrdoob/three.js/blob/5ce11d18c400791da0c9fbb4b6b9fcde2f754443/examples/models/mmd/Readme.txt) and [model notice](https://github.com/mrdoob/three.js/blob/5ce11d18c400791da0c9fbb4b6b9fcde2f754443/examples/models/mmd/miku/readme.txt) | Complete text fetched and hashes matched the existing manifest. The directory notice defers to original asset terms, excludes MIT and warns about unmentioned uses; the model notice identifies an MMD stock model. | Neither is an Animasa grant nor a model-specific ban on the proposed use. The directory's general warning must not be treated as proof that this stock model forbids redistribution. |
| [Pinned MMD 5.24 readme](https://github.com/mrdoob/three.js/blob/5ce11d18c400791da0c9fbb4b6b9fcde2f754443/examples/models/mmd/miku/readme_miku_v2.txt) | Complete text fetched and SHA-256 matched `6732866be1a712d7af142fcbf59f7e3bab8691ea472f86bb674020b13d51355a`. Permits images/video and PMM/VPD/VMD publication; explains including textures with a published model. | Corroborates model/texture publication as an anticipated workflow. It does not itself identify Animasa's distribution grant for this stock model. |

All observations above were made on 2026-11-01. Links to mutable web pages record
the source and dated assessment, not an invented immutable license revision.
The manifest pins the historical asset/notice bytes; the interview links and
publication date identify the directly attributable statement. No rights holder
has been contacted by this change and no new permission is claimed.
