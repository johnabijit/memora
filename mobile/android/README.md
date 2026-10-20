# Memora Android 1.1

This version uses a native Android WebView launcher rather than Trusted Web Activity to eliminate the dependency on browser launcher verification and improve startup reliability.

- Package: `com.memora.mobile`
- Android 6.0 or newer, internet connection and Android System WebView required.
- Uses the existing live Memora site: https://memora-37z.pages.dev/
- JavaScript, local storage, audio playback, email login, saved memory, file chooser, and microphone/camera permissions are supported.
- OAuth providers and other external websites open in the system browser. Social login may not return the session to the embedded app; use email login in the native wrapper or install the PWA from Chrome for browser-based social OAuth.
- No secrets or saved memories are stored in the APK.
- While loading, a spinner is shown. On network failure, Retry and Open in browser actions appear.
- This is an unsigned-for-distribution test build (APK is debug signed). It is not yet tested on the user's device.

Because the previous APK was signed by a different GitHub Actions runner, uninstall the previous Memora APK before installing this new build. **Deleting the app will not delete the memories stored in Supabase, but local WebView login and settings will be reset.**

Build: `gradle :app:assembleDebug`. GitHub Actions creates a downloadable APK artifact.
