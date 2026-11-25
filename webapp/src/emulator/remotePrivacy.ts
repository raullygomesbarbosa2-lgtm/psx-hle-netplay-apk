import { useEffect, useState } from 'react';

const PRIVACY_KEY = 'psx_remote_privacy_enabled';
const CHANGE_EVENT = 'psx-remote-privacy-change';

declare global {
  interface Window {
    AndroidRuntime?: {
      setRemoteSessionActive?: (active: boolean) => void;
      openDndAccessSettings?: () => void;
    };
  }
}

export function isRemotePrivacyEnabled(): boolean {
  try {
    return window.localStorage.getItem(PRIVACY_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function setRemotePrivacyEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(PRIVACY_KEY, String(enabled));
  } catch {
    // Keep the preference in this page even if storage is unavailable.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useRemotePrivacyEnabled(): boolean {
  const [enabled, setEnabled] = useState(isRemotePrivacyEnabled);
  useEffect(() => {
    const refresh = () => setEnabled(isRemotePrivacyEnabled());
    window.addEventListener(CHANGE_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(CHANGE_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);
  return enabled;
}

/** Requests temporary, local DND only in the native APK; the Remote Play stream itself is game-canvas-only. */
export function setPrivacySessionActive(active: boolean): void {
  try {
    window.AndroidRuntime?.setRemoteSessionActive?.(active && isRemotePrivacyEnabled());
  } catch {
    // Browser builds and WebViews without the native bridge retain game-only streaming.
  }
}

export function openDndAccessSettings(): void {
  try {
    window.AndroidRuntime?.openDndAccessSettings?.();
  } catch {
    // Not available outside the Android APK.
  }
}
