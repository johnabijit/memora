# Memora for Android

This directory builds a sideloadable Android APK using Google's Trusted Web Activity launcher.

- Production URL: https://memora-37z.pages.dev/
- Package: `com.memora.mobile`
- Min Android API: 23
- The application uses the installed browser to open the live Memora site and keeps browser-based authentication working.

## Build

Use Java 17 and Android SDK 35 and Gradle 8.11.1.

```bash
gradle :app:assembleDebug
```

The APK is written to `app/build/outputs/apk/debug/app-debug.apk`. A GitHub Actions workflow uploads the APK as a downloadable artifact.

## Important for full-screen TWA

Until `https://memora-37z.pages.dev/.well-known/assetlinks.json` contains the correct SHA-256 of the APK's signing certificate, Chrome displays this launcher in a Custom Tab with browser controls rather than a verified full-screen TWA. This is not an OAuth issue and is safer than hiding the browser identity. A debug APK is suitable only for personal testing. Use a securely stored release signing key and matching Digital Asset Links before publication.

This APK loads the hosted Memora and needs network access for live memory/AI features. It does not bundle personal memories, passwords or API secrets.
