# Full-stream video verification

Run `./validation/test_all.sh --suite validation` for the integrated check, or
build Node and run `node validation/video-stream-verification/test-video-stream.mjs`.
Requires FFmpeg 6.1+ and ffprobe with libx264. CI installs ffmpeg.
No device is used by this harness.

Fixtures are generated in a temporary directory and removed after the run:
valid CFR, a late damaged NAL packet with a decodable opening frame, a truncated
tail, bursty VFR, three consecutive H.264 dimension spans, and 180-second 60-fps clips in both default maximum orientations
and full HD. Every production decode uses its actual deadline. Fixture encoding
has a separate 300-second deadline; subprocess diagnostics are bounded throughout.
The corrupt fixture also passes through worker finalization with simulated
recorder transport and real media subprocesses, checking retained partial bytes,
probe metadata, caller verdict, hashes, ownership release, and repeated stop.

The scrcpy worker fixture simulates only recorder transport and runs real frame
inspection, encoding and verification. It asserts one capture yields three
independently sized MP4s, all source frames survive, timestamps match every source frame after rebasing to zero,
and completed stop is immutable. A second dimension-span fixture adds a sparse
final-frame gap and requires aggregate MP4 duration to retain that timeline
(with at most one second of segment endpoint tolerance), alongside exact frame
counts and timestamps. This catches B-frame reordering that shortens MP4
duration tables without dropping decoded frames. It requires no scrcpy installation.

An optional `VIDEO_FIXTURE_OUTPUT` environment variable names an existing local
directory in which to retain the small valid/corrupt/VFR fixtures. Do not commit
media or private live evidence. See the [design](../../docs/internal/design/managed-video.md#verification-and-partial-evidence)
for resource limits and live validation findings.

For version compatibility, run the same harness with each isolated FFmpeg/ffprobe
pair prepended to PATH. Do not relink the host installation. The baseline is
FFmpeg 6.1; also exercise 8.1.3 and 9.0.2. Fixture generation uses modern options
so a harness failure cannot be mistaken for a production legacy-option failure.
