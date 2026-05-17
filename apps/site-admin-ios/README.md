# Site Admin iOS Companion

Native SwiftUI companion for managing `jinkunchen.com` from iPhone.

## Scope

- Reads the compact mobile summary from `/api/site-admin/mobile/summary`.
- Updates the public Now status through `/api/site-admin/now`.
- Starts the unified remote release flow through `/api/site-admin/release-jobs/smart`.
- Uses the existing Site Admin app-token flow with the iOS callback URL:
  `jinnkunn-site-admin://auth/callback`.

The app is intentionally not a mobile clone of the Tauri workspace. Complex
site structure editing stays in desktop/web Site Admin; this app is the quick
control surface for status, content counts, runner health, and release actions.

## Local Build

Open `SiteAdminCompanion.xcodeproj` in Xcode, or build the simulator target:

```bash
xcodebuild \
  -project apps/site-admin-ios/SiteAdminCompanion.xcodeproj \
  -scheme SiteAdminCompanion \
  -destination 'platform=iOS Simulator,name=iPhone 16' \
  build
```

## Install on Jinnkunn iPhone

The project is configured for automatic signing with the Personal Team
`R9Y43HDY4Z` and bundle id `com.jinkunchen.SiteAdminCompanion`.

Before device install:

1. Open Xcode > Settings > Accounts and sign in with the Apple ID that owns
   team `R9Y43HDY4Z`.
2. Connect `Jinnkunn iPhone 15` once over USB and trust the Mac.
3. Keep Developer Mode enabled on the iPhone.
4. If wireless install is desired, enable "Connect via network" in Xcode's
   Devices and Simulators window after the first USB pairing.

Then run:

```bash
xcodebuild \
  -project apps/site-admin-ios/SiteAdminCompanion.xcodeproj \
  -scheme SiteAdminCompanion \
  -destination 'platform=iOS,id=00008130-00063C911181001C' \
  -configuration Debug \
  -derivedDataPath /tmp/SiteAdminCompanionDeviceDerivedData \
  -allowProvisioningUpdates \
  -allowProvisioningDeviceRegistration \
  build
```

If the build succeeds, Xcode can run/install it from the same project and
scheme. The current command-line blocker is usually a missing Xcode Account or
matching development provisioning profile, not the app source.
