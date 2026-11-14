# APK license inventory

The Operator's top-right information control opens a full-screen offline license
viewer. Back returns to the service screen. The viewer uses Android WebView with
JavaScript, file/content access and network loading disabled. License anchors stay
in the document; HTTPS links to external terms open the browser.

Each APK variant runs `:app:generateDebugOpenSourceLicenses` or
`:app:generateReleaseOpenSourceLicenses` as a dependency of asset merging. Gradle
passes its resolved runtime module coordinates to `scripts/licenses/generate.py`.
The generated `open_source_licenses.html` lives under the app build directory and
is bundled as an asset. Python 3 is required; generation does not fetch the network.

The inventory includes transitive modules and metadata-only components such as
BOMs, so it is a conservative runtime graph inventory, not an R8-retained-code
report. Build plugins and test-only dependencies are excluded. Kotlin source
license headers under `src/main/` are included as source notices. This does not
automatically discover licenses in arbitrary artwork, native binaries or copied
code without headers; maintain those notices explicitly when adding such content.
The GitHub logo is identified separately as trademarked artwork.

## Updating dependencies

A new runtime coordinate or version without an exact entry in
`scripts/licenses/metadata.json` fails generation. Review the dependency's POM,
license, upstream notices and packaged JAR/AAR notices before adding its metadata.
Do not infer a license from the dependency group or silently apply a default.
The checked-in metadata records the POM URL for each coordinate; overrides for
POMs without license declarations record an additional upstream license source.

Keep license text and copyright notices in `scripts/licenses/texts/`. Shared
license text can be referenced by multiple modules. Preserve embedded third-party
notices, including Kotlin reflection's embedded Protobuf license and Kotlin's
Boost-derived math notices. Text provenance is recorded in the metadata's `texts`
map.

The APK does not depend on Google Play Services. Its unused coroutines adapter
previously brought in Play Services tasks and basement, including broad ICU4C,
STL, UTF and dictionary notices. Removing the adapter removed that dependency
path; the associated notices and SDK terms snapshot were removed with it. Do not
reintroduce this integration without a concrete caller and a license review.

Run:

```bash
python3 validation/licenses/test_generate.py
./gradlew :app:assembleDebug :app:generateReleaseOpenSourceLicenses :app:testDebugUnitTest
```

Inspect the generated inventories and APK asset. Verify the full-screen reader,
local license anchors, scrolling and Back on a device. The Python regression
checks also run in the Android validation suite used by CI.

## APK dependency audit, 2026-11-14

Scope is code and resources packaged in the Operator APK. Node packages, build
plugins and test-only libraries are excluded. The owner permits Apache 2.0,
Mozilla, Android terms, BSD and licenses embedded in Kotlin.

- The unused `kotlinx-coroutines-play-services` declaration in core/common was the
  only resolved path to Play Services tasks and basement. No source imports of
  the adapter or Google Tasks APIs were found. Removing it eliminates the Google
  SDK modules and their ICU4C, STL, UTF and dictionary notice bundle. A bundled
  GPL-with-exception notice was not itself evidence that the whole app was GPL.
- `org.slf4j:slf4j-api:1.7.36` was MIT-licensed and came through Ktor's client and
  coroutine logging integration. Ktor and OkHttp clients were registered in Koin,
  but the repository had no consumers of those registrations beyond their
  factories. The unused HTTP stack, its factories, DI registrations and the unused
  `ProgressRequestBody` helper were removed, eliminating SLF4J, Ktor, OkHttp and
  Okio from both APK runtime graphs. Excluding SLF4J alone would have risked
  class-loading failures in Ktor.
- Kotlin reflection embeds Protobuf code under BSD. A release build retained
  classes under `kotlin.reflect.jvm.internal.impl.protobuf`. The upstream reflect
  build explicitly embeds Protobuf Lite; its 2.6.1 lineage uses BSD terms. These
  notices are bundled separately from the Apache license.
- Kotlin's standard-library license inventory identifies Boost-derived inverse
  hyperbolic math functions. In the audited release, R8 removed `asinh`, `acosh`
  and `atanh`. The conservative dependency inventory still includes their license
  text because debug variants are not shrunk. This is within the owner's Kotlin
  exception; it is not a reason to replace the Kotlin standard library.
- The GitHub footer mark has separate trademark usage terms. It is artwork, not a
  software library, and can be removed without affecting runtime functionality.

No APK feature was identified as requiring an unapproved library license. The
remaining reviewed module licenses are Apache 2.0 with Kotlin's embedded BSD and
Boost exceptions. This audit did not prove the absence of every embedded license in
all transitive source distributions; top-level POM labels are not sufficient for
that claim. Keep reviewing embedded code and notices when dependency versions
change.
