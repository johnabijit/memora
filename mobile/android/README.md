# Memora Android 1.6

Native Android application wrapper for the existing Memora Cloudflare service.

- Android package: `com.memora.mobile` (Android 6+, Android System WebView).
- Uses Memora's existing ribbon logo on the Android launcher and live website.
- All Memora screens, search, memories, radio, player and settings stay within the application WebView.
- Google and supported social sign-in use Android Custom Tabs, a secure in-app browser surface rather than an embedded WebView (which Google disallows for OAuth). Once authorized, the callback `memora://auth/callback?code=...` routes back to the running Memora activity and completes PKCE login in the existing WebView.
- The identity provider or browser may display its own secure UI; this cannot and should not be eliminated.
- Supabase must have `https://memora-37z.pages.dev/` in allowed redirect URLs and Google login must be enabled.
- Built APK is debug signed for testing, not production store signing.
- No API secrets or personal memory data are bundled in the APK.
- The APK build workflow publishes `Memora-Android-v1.6.apk` as a GitHub Actions artifact.
- Existing APK users may need to uninstall a version signed with a different debug key before installing. Uninstalling clears local WebView session/settings, but does not delete server-stored memories.

## Verify on an Android device
1. Open Memora and press Continue with Google.
2. Confirm a secure in-app Google Custom Tab appears, rather than a full browser app or a Google page inside the WebView.
3. Complete login, follow the return to Memora, and verify the app has an authenticated session.
4. Switch between Home, Memories, Music and Themes. Ensure navigation stays inside Memora.
5. Check music, camera, voice, and file uploads, as permission prompts and behavior depend on the device.

If the callback is not returned automatically, the approved HTTPS return page provides an explicit Open Memora button.
