# Android publication

Every application change intended for Interface Studio must publish a standalone APK through the Android workflow, including changes to android-window-profile.json. Retain the original signing key across all builds. ANDROID_DEBUG_KEYSTORE_BASE64 must contain the existing debug.keystore (the standard Android debug key password and alias), never a newly generated key. The legacy cache is a fallback only; if neither source supplies the key, fail the build instead of rotating the signing identity.

Never uninstall the user's app or clear its data to bypass a signature conflict. Report publication and installation separately, and verify the installed build before claiming the real-device panel displays the update.
