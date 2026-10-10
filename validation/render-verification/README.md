# Post-action rendering verification validation

The maintained Node helper is `apps/node/src/renderVerification.ts`. Its tests
run in the Node suite. `policy.test.cjs` tests the example-owned Settings predicate
and runs in validation CI. No physical device or OCR is needed for either suite.

`live.mjs` is an opt-in laboratory consumer of that helper. It does not ship a
production capture backend, OCR dependency or automatic CLI rendering check.
Build Node and the existing experimental direct-buffer DEX using
[the capture experiment instructions](../agent-loop-latency/screenshot-scales.md).
Provide a local executable that accepts one image path and emits JSON OCR rows
with `text`, `confidence` and normalized top-down `top` fields. The existing
macOS Vision experiment implements this interface; no OCR binary is distributed.

```sh
npm --prefix apps/node run build
node --test validation/render-verification/policy.test.cjs
node validation/render-verification/live.mjs \
  --device <device_serial> --out /absolute/private/new-output \
  --ocr /absolute/local/pixel-recognizer --dex /absolute/local/classes.dex
```

The explicit physical phone must be unlocked, stationary and in portrait with
Settings full-screen. The output directory must not exist. Use one controller;
do not run builds, tests or other device automation during measured trials.
No phone settings are changed. Actions use the branch-local CLI and development
Operator. The harness uploads its own uniquely named temporary helper, closes
its session and removes that file in `finally`. It preserves all raw evidence
privately, including failed attempts. A new directory is required for another run.
Set `RENDER_PILOT_ONLY=1` to stop after a separate pilot; such runs are excluded
from primary performance comparisons.

The harness uses one excluded pilot, then three alternating full-only versus
quarter-first pairs. Each trial verifies actual About phone heading pixels after
a canonical click, then separately checks Build number pixels and semantic rows
after scrolling. Snapshots and display checks bracket every capture. The acquired
frame that passes is the returned frame; there is no later unverified capture.
The native source display geometry is retained separately from reduced PNG size.

Preparation checks that the About phone row is painted and that its snapshot
bounds remain unchanged before the click. Arrival requires visible `Basic info`
and `Device name` snapshot content plus an About phone heading in the screenshot's
top region. The tested Android build paints the heading while reporting its
accessibility node as invisible with zero-width bounds. After scrolling, the
semantic anchor is visible `Build number`; pixels must show both the heading and
Build number. These are complementary checks, not interchangeable evidence.

The full-only arm permits two full observations. The quarter-first arm permits
three quarter observations then two full observations. Both share a 30-second
verification deadline; the quarter arm reserves six seconds for fallback.
The reserve includes canonical acquisition and verification and is not a guarantee
that a fallback will finish. These harness budgets are explicit experimental
choices, not tuned production defaults. Record observation latency separately
from navigation/setup and provider-loop time; this harness makes no model calls.

Five separate fault trials retain original pixels and original OCR:

- `delayed-frame`: substitute actual pre-click Settings pixels for the first two
  acquisitions, explicitly recording injection. New snapshot evidence cannot
  make those old pixels pass. A later real frame must independently pass.
- `small-unreadable`: mark only reduced-image recognition unsuccessful. Bounded
  small attempts must lead to a separately verified full-resolution image.
- `wrong-destination`: use a deliberately impossible destination condition at
  both sizes. Keep action success and report rendering unverified.
- `both-unreadable`: mark recognition unsuccessful at both sizes; fail closed.
- `cancel`: cancel during visual verification; publish no accepted capture.

Fault and pilot timings are excluded from ordinary performance aggregates. These
are explicit synthetic recovery tests, not claims about natural OCR error rates.
The earlier hidden-API compatibility limits still apply to the experimental
quarter backend. Screenshot/tree observations remain non-atomic, and this known
English Settings predicate is not a universal visual-settling detector.
