# Issue #19 post-merge publication verification

Verification on 2026-11-05 targets merged [PR #20](https://github.com/takahirox/three-motionbricks/pull/20),
merge commit `3b46a9dd300e6d766542cc1407e427842af7e7d1`, reviewed head
`80aed164741cedd989ce6b5dfbaa91752ccb1a40`. **Issue #19 remains open.**
The implementation is intentionally partial; publishing it does not establish
reliable forward/backward generated recovery.

[Machine-readable results](balance-public-validation.json) retain deployment
identity, per-file hashes, browser results and incomplete model checks. The
checkpoint tree before recording these results was
`3310efbc031d926905f450c36529c82027caa2a1`, exactly matching the merge commit's
GitHub tree. No implementation was republished or changed for this verification.

## Completed checks

- The merge-triggered [Pages workflow](https://github.com/takahirox/three-motionbricks/actions/runs/42021728984)
  completed successfully for the actual merge commit. Both build and deploy jobs
  passed. Hosted tests, production build and artifact checks passed in that run;
  they were not replaced with results from the earlier PR workflow.
- A fresh `npm ci` and `npm run build` succeeded. Every one of the 27 files
  (44,065,756 bytes) at the public HTTPS origin returned HTTP 200 and matched the
  local production build's SHA-256, including both HTML entries, generated
  JavaScript/CSS, inference worker, ORT WASM, all three character resources,
  physics runtime, conversion records, original notices and licenses. This
  comparison establishes which source was published, beyond merely loading HTML.
- [Public Pose studio](https://takahirox.github.io/three-motionbricks/pose.html)
  rendered in isolated HeadlessChrome 157 with WebGPU in a secure context.
  The existing `test:pose` completed SOMA and Animasa Move/Rotate, foot and hips
  editing checks, then **failed** its default 30-second Uka-selection wait.
  Its two completed character reports contain no JavaScript errors; the entire
  command is not reported as passing.
- A focused follow-up allowed 180 seconds for public resources. Uka loaded;
  small/large push and release phases, waiting without generation, Move/Rotate,
  physics disposal/restart, mobile overflow, both navigation links and browser
  history navigation passed. It recorded no JavaScript or HTTP errors. Thus the
  initial timeout is consistent with slow asset transfer, rather than a missing
  published Uka asset. This is a focused check, not a pass for unexecuted portions
  of the original smoke suite.
- Published instructions explicitly label deterministic disturbance IK,
  experimental checkpoint capability, ONNX recovery, conditioning targets that
  never play as animation, and bounded contact corrections. Notices and licensing
  resources match the reviewed sources byte for byte.

## Incomplete checks and remaining behavior

Fresh public-origin ONNX recovery verification has **not completed**. The normal
production model request made progress to 24 / 758 MB without a JavaScript error.
It was stopped during transfer to attempt the repository's verified-cache testing
approach; no ONNX session or generated motion from that attempt is claimed.
A separate 1 MiB public-host range probe returned HTTP 206, the correct total
length and `Access-Control-Allow-Origin: *`. That probe does not verify the full
model payload or successful inference.

The attempted cache download used twelve concurrent 4 MiB range requests with a
180-second request deadline. It failed with a download timeout before any full
range completed; no complete payload or SHA-256 verification was obtained. The
planned cached runtime sweep was therefore **not run**. This transport/test
deadline is not evidence of failed model recovery. The JSON records these
outcomes separately from the deliberate stop of the ordinary download.

Model loading, full public worker/WASM execution and actual small/large ONNX
responses must remain pending until a complete verified model is available and
the checks run. Fetching the worker and WASM successfully is not proof that they
executed inference. No saved pre-merge trace is relabeled as fresh inference.

The [saved feasibility measurements](balance-validation.md#measured-checkpoint-feasibility)
establish earlier lateral settling and generated stepping on all three
characters. Their forward trial failed strict raw settling, and the backward
trial exhausted six generations without settling. Those limitations remain;
neither publication checks nor the displayed stability label resolve them.
Contact-aware landing/settling conditioning remains the smallest proposed next
experiment, with a separate balance policy or training if needed.

Refs #19. Keep the Issue open while required verification or recovery behavior
remains incomplete. Publication retries remain zero. No usage reset, allowance
purchase, provider/model switch, deployment dispatch, port 8765 change or Project
mutation was performed.
