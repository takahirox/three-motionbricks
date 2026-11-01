# Animasa public delivery — Issue #13

## Decision on 2026-11-01

**Public delivery remains blocked; the local-only implementation from #11 is
preserved.** This review evaluates the additional evidence in
[Issue #13](https://github.com/takahirox/three-motionbricks/issues/13), including
the maintainer's latest direction. It does not reopen the completed conversion,
retargeting or physics integration. Uka remains a separately named option.

The evidence supports a favorable interpretation of Animasa's intent to permit
reuse of the original stock model. However, the Issue specifically requires
complete applicable original terms or explicit rights-holder authorization for
distribution. The inspected first-person statement expresses intent without
specifying whether editable model data and accompanying stock resources may be
redistributed. Treating it as that grant would require an inference the current
prerequisite does not resolve. No GLB, PMD or texture has been acquired for this
change, committed, uploaded, automatically fetched or published.

This is a missing scope record, not a finding of a prohibition. In particular,
**no inspected asset term specifically prohibits GLB conversion, GitHub Pages,
or reuse of `eyeM2.bmp` separately from its stock model.** The absence of a
Three.js MIT license is not the basis for rejecting Animasa permission.

## Evidence and provenance

The [source manifest](../scripts/animasa-manifest.json) identifies Three.js r87
commit `5ce11d18c400791da0c9fbb4b6b9fcde2f754443`, including the exact PMD,
eye bitmap, notices and loader. The PMD is ver.2.3, SHA-256
`45a5a2fb897266a1b371b30cf53ed9435d375ddea9fce7f095bba2739b9bdae5`,
with header credits identifying Animasa and Crypton. Its identity and the
conversion contract remain documented in [animasa.md](animasa.md).

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

## Specific remaining evidence

An attributable original stock-model usage statement, original distributor terms
issued with the author's authority, or an explicit response from Animasa/the
authorized distributor must establish that **the original stock Miku model may
be modified and redistributed with its accompanying stock resources**. A broad
grant covering those acts and resources can suffice; it need not name GLB,
GitHub or each texture individually if its scope clearly includes them. Record
the source/date, exact applicable text, affected assets and any conditions.

For a direct confirmation, identify the PMD hash above, `eyeM2.bmp` hash
`a318f2d5bd22e3ac3a5b8cab4021fd68e25042e7730e8c04720cee68e3548565`,
and the stock toon01/02/03 PNGs embedded in the pinned r87 `MMDLoader.js`.
Describe lossless eye conversion to PNG, embedding all four images in a skinned
GLB, and free noncommercial public GitHub repository/Pages delivery. Confirm
that the stock-resource permission covers these supplied images or identify
their author/terms if it does not. The existing manifest pins the loader bytes;
there are no other referenced textures or sphere maps in this conversion.

The maintainer's assessment that stock assets should share the stock model's
permission is reasonable supporting context. It is not being rejected because
of a discovered texture-specific restriction. The remaining gap is an
attributable distribution scope covering the stock package; **separate bespoke
permissions for every texture or every hosting platform are not required**.
The primary interview plus secondary reports make that scope plausible, while
leaving it unconfirmed under the Issue's stated prerequisite. This document
records the gap without issuing another generic request for a license.

## Prepared delivery and notice plan

Once the scope above is established, use the existing pinned offline converter
and validate its deterministic output. Deliver from the same Pages origin at
`BASE_URL + assets/animasa/model.glb`; this avoids dependence on a third-party
asset host and additional CORS configuration. Do not add a runtime PMD download.

Review and add only these individual files to Vite's build list and the
independent `check:pages` required-file list:

- `assets/animasa/model.glb`
- `assets/animasa/conversion.json`
- `assets/animasa/README.md` (permission record, source pins, changes and conditions)
- `assets/animasa/notices/Readme.txt`
- `assets/animasa/notices/miku/readme.txt`
- `assets/animasa/notices/miku/readme_miku_v2.txt`

Keep original notices byte-for-byte. Publish neither the source PMD, loose
textures, loader source, conversion scratch files nor `.cache/`. The existing
Actions build already runs tests, build and the independent upload-directory
check before uploading only `dist/`. Its permissions and upload path need no
expansion. No dormant URL, publication flag or allowlist entry is enabled now.

Update the converter's local-only publication metadata when authorized, then
regenerate and verify the expected GLB size/SHA-256 in `src/animasa.ts`; changing
metadata changes the deterministic bytes. Preserve all existing MMD extensions
and local override verification. The normal Animasa selection should fetch and
verify that asset, with the same cancellation, disposal and retry handling as
the current character loader. Keep local file selection as an optional override.

At delivery, update the visible model credits, `public/NOTICE.txt`,
`THIRD_PARTY_NOTICES.md`, README and this decision with the actual permission
record. The following is prepared credit/condition wording, **not a grant**:

> Hatsune Miku — modeling and original data conversion: Animasa (あにまさ).
> Character © Crypton Future Media, INC. Character use is subject to the
> [Piapro Character License](https://piapro.jp/license/pcl) and
> [Crypton character-use guidelines](https://piapro.jp/license/character_guideline).
> Follow those guidelines when using this model. This free noncommercial demo
> converts the stock PMD to skinned GLB, embeds its eye/toon images and retains
> MMD material, solver and rigid-body metadata. See the accompanying original
> notices and permission record for model/resource terms. No endorsement implied.

Do not label the asset MIT, CC BY, CC BY-NC or public domain based on the code,
wiki, interview or unrelated character illustrations. Record the established
model/resource terms alongside the independent character conditions.

## Checks and remaining acceptance

For this non-distributing change, mandatory pre-merge checks are `npm test`,
`npm run build`, `npm run check:pages`, production-prefix browser smoke and
documentation/link/whitespace review. The Pages regression uses synthetic files
to reject additional GLBs, a GLB renamed as generated JavaScript, PMD, eye/toon
textures and unreviewed conversion records. The browser smoke checks that local
Animasa selection and invalid-file recovery do not transfer character assets;
with `ANIMASA_GLB` it also checks the verified local load. These checks run through
the existing commands; no new dependency or CI build is required.

For authorized public delivery, mandatory pre-merge validation also includes the
exact-source Animasa integration test, deterministic asset/notice checks and
production-prefix browser checks using automatic selection without an upload:
WebGPU MotionBricks walk/run/turn/stop, SOMA retargeting, visible hair/skirt
physics, retained IK/FK behavior, repeated character switching, a missing or
corrupted GLB, missing Ammo and recovery. Preserve SOMA/Uka regression coverage.
The existing browser smoke and IK comparison supply the local starting point;
the automatic-delivery branch still needs implementation after rights clearance.

Required post-merge verification for eventual delivery: a successful Pages
workflow and the same automatic-selection and real-inference browser checks at
`https://takahirox.github.io/three-motionbricks/`, with asset hashes, required
notices and successful network responses verified there. A local File supplied
to a public-origin browser does not prove automatic public delivery. More devices
and subjective animation polish are optional.

No post-merge check is needed for the current non-distributing preparation.
Issue #13 must remain open: rights clearance, automatic asset delivery and its
deployed-origin validation are outstanding. See the [validation record](animasa-publication-validation.md)
for this change's actual checks; historical #11 results are not new #13 evidence.
