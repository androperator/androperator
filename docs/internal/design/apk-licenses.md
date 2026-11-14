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
notices, including Google Play Services' `third_party_licenses.txt` and OkHttp's
Public Suffix List notice and MPL text. Google Play Services is proprietary and
must remain labeled with SDK terms, rather than presented as Apache-licensed.
Text provenance is recorded in the metadata's `texts` map. The SDK terms snapshot
was retrieved from the official Android terms page; it is not a claim that every
historical SDK artifact used precisely that revision of the terms.

Run:

```bash
python3 validation/licenses/test_generate.py
./gradlew :app:assembleDebug :app:generateReleaseOpenSourceLicenses :app:testDebugUnitTest
```

Inspect the generated inventories and APK asset. Verify the full-screen reader,
local license anchors, scrolling and Back on a device. The Python regression
checks also run in the Android validation suite used by CI.
