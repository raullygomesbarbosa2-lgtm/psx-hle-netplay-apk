# PSX HLE NetPlay Android APK

This Android package embeds the supplied React/Vite app in a WebViewAssetLoader shell so the original visual interface and web emulator components remain intact. It bundles the web app locally and uses the existing PSX HLE relay for multiplayer WebSocket/WebRTC signalling and game audio/video. It is not a native reimplementation of the PS1 core.

The only app-code additions are a Firebase password-reset action on the login view and a build-time configurable WebSocket relay URL so the bundled APK can reach the relay. Other app UI, graphics and emulator modules are kept from the supplied project.

Minimum Android: 6.0 / API 23. The APK requires internet for Firebase authentication, multiplayer and WebRTC. Password reset uses Firebase Authentication; the Firebase project must have email/password sign-in enabled and configured email templates. WebRTC/network play is not validated on two physical devices by merely compiling this APK.
