---
name: com.android.vending.search-app
description: Search for an Android app in the Google Play Store and navigate to its details page.
---

Searches for a named app in the Google Play Store and navigates to the app details page.
Returns a snapshot of the details page on success, which can be used directly by
`com.android.vending.install-app`.

Supports two entry paths:
- **Search path (default):** Opens the Play Store, navigates to the Search tab, types the
  query, selects the first matching suggestion, then taps the first result to open its
  details page.
- **Direct package path:** If a known Android package ID is provided, uses
  `adb shell am start` with a `market://details?id=<package>` URI to open the app's
  details page directly. On devices with multiple app stores installed, an "Open with"
  picker may appear and must be handled.

## Usage

```bash
./skills/com.android.vending.search-app/scripts/search_play_store.sh <device_id> <query> [receiver_package]
```

For the direct-entry path (known package ID):
```bash
./skills/com.android.vending.search-app/scripts/search_play_store.sh <device_id> <query> [receiver_package] [package_id]
```

Examples:
```bash
# In-app search path
./skills/com.android.vending.search-app/scripts/search_play_store.sh <device_serial> "VLC"

# Direct entry path
./skills/com.android.vending.search-app/scripts/search_play_store.sh <device_serial> "VLC" com.androperator.operator org.videolan.vlc
```

## Output

On success, prints a summary of the app details page including:
- App name
- Developer
- Rating
- Install state (Install / Open / Uninstall)
- Download count

## Blocking states

- **"Open with" picker:** Appears on devices with multiple app stores. Script handles
  this by clicking "Google Play Store" when present.
- **Login prompt:** If the user is not signed in to Google Play, an account picker or
  sign-in screen will appear. Script exits with an error message.
- **App not found:** If no results are returned for the query, script exits with an error.

## Notes

- No resource-ids are present on Play Store UI elements. All selectors use text,
  content-desc, or role matchers.
- content-desc attributes in Play Store use HTML entity encoding (`&apos;` etc). Use
  `contentDescContains` for substring matching instead of exact matches.
- The search input field has no resource-id; use `role: "textfield"` to target it.
- From the search path, clicking the first app entry navigates to a full-page details view.
- From the direct path, the market:// URI opens a bottom sheet details view. Both support
  the Install button in the same way.
- This embedded copy is used by `test-recording-validate` and is expected to run
  against the branch-local Androperator CLI build and the `.dev` Operator APK.
  It should not depend on the globally installed `androperator` binary.
