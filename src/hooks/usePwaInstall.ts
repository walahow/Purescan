import { useCallback, useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type PwaUpdateStatus = 'idle' | 'checking' | 'up-to-date' | 'offline';

let swInitialized = false;
let swNeedsUpdate = false;
let swRegistration: ServiceWorkerRegistration | null = null;
let swUpdateRunner: ((reloadPage?: boolean) => Promise<void>) | null = null;
let lastAutoCheckAt = 0;

const updateListeners = new Set<(needsUpdate: boolean) => void>();

function notifyNeedsUpdate(next: boolean): void {
  swNeedsUpdate = next;
  for (const listener of updateListeners) {
    listener(next);
  }
}

function initServiceWorkerUpdater(): void {
  if (swInitialized || typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }
  swInitialized = true;

  swUpdateRunner = registerSW({
    immediate: true,
    onNeedRefresh() {
      notifyNeedsUpdate(true);
    },
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      swRegistration = registration;
      if (registration.waiting) {
        notifyNeedsUpdate(true);
      }
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            notifyNeedsUpdate(true);
          }
        });
      });
    },
  });
}

function isStandaloneMode(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    Boolean(window.matchMedia?.('(display-mode: standalone)').matches) ||
    nav.standalone === true
  );
}

export function usePwaStatus() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState<boolean>(isStandaloneMode);
  const [isOffline, setIsOffline] = useState<boolean>(
    typeof navigator !== 'undefined' ? !navigator.onLine : false
  );
  const [needsUpdate, setNeedsUpdate] = useState<boolean>(swNeedsUpdate);
  const [updateStatus, setUpdateStatus] = useState<PwaUpdateStatus>('idle');

  const checkForUpdate = useCallback(async (silent = false): Promise<boolean> => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      if (!silent) setUpdateStatus('offline');
      return false;
    }

    initServiceWorkerUpdater();

    let reg = swRegistration;
    if (!reg && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      reg = (await navigator.serviceWorker.getRegistration()) ?? null;
      if (reg) swRegistration = reg;
    }

    if (!reg) {
      if (!silent) {
        setUpdateStatus('up-to-date');
        window.setTimeout(() => {
          setUpdateStatus((prev) => (prev === 'up-to-date' ? 'idle' : prev));
        }, 2400);
      }
      return false;
    }

    if (reg.waiting) {
      notifyNeedsUpdate(true);
      setUpdateStatus('idle');
      return true;
    }

    if (!silent) setUpdateStatus('checking');
    try {
      await reg.update();
      if (reg.waiting) {
        notifyNeedsUpdate(true);
        setUpdateStatus('idle');
        return true;
      }

      if (reg.installing) {
        const installing = reg.installing;
        await new Promise<void>((resolve) => {
          const timer = window.setTimeout(resolve, 4000);
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' || installing.state === 'redundant') {
              window.clearTimeout(timer);
              resolve();
            }
          });
        });
        if (reg.waiting || swNeedsUpdate) {
          notifyNeedsUpdate(true);
          setUpdateStatus('idle');
          return true;
        }
      }

      if (!silent) {
        setUpdateStatus('up-to-date');
        window.setTimeout(() => {
          setUpdateStatus((prev) => (prev === 'up-to-date' ? 'idle' : prev));
        }, 2400);
      }
      return false;
    } catch {
      if (!silent) setUpdateStatus('idle');
      return false;
    }
  }, []);

  useEffect(() => {
    initServiceWorkerUpdater();
    setNeedsUpdate(swNeedsUpdate);

    const listener = (next: boolean) => setNeedsUpdate(next);
    updateListeners.add(listener);

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstallEvent(null);
      setIsInstalled(true);
    };
    const onOnline = () => {
      setIsOffline(false);
      void checkForUpdate(true);
    };
    const onOffline = () => setIsOffline(true);

    const maybeAutoCheck = () => {
      if (document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - lastAutoCheckAt < 25_000) return;
      lastAutoCheckAt = now;
      void checkForUpdate(true);
    };

    const mql = window.matchMedia?.('(display-mode: standalone)');
    const onDisplayChange = (ev: MediaQueryListEvent) => {
      if (ev.matches) setIsInstalled(true);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('focus', maybeAutoCheck);
    document.addEventListener('visibilitychange', maybeAutoCheck);
    mql?.addEventListener?.('change', onDisplayChange);

    return () => {
      updateListeners.delete(listener);
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('focus', maybeAutoCheck);
      document.removeEventListener('visibilitychange', maybeAutoCheck);
      mql?.removeEventListener?.('change', onDisplayChange);
    };
  }, [checkForUpdate]);

  const promptInstall = useCallback(async () => {
    if (!installEvent) return false;
    await installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    setInstallEvent(null);
    if (outcome === 'accepted') setIsInstalled(true);
    return outcome === 'accepted';
  }, [installEvent]);

  const applyUpdate = useCallback(async () => {
    if (swUpdateRunner) {
      await swUpdateRunner(true);
      // Fallback reload if controllerchange was handled silently by browser
      window.setTimeout(() => window.location.reload(), 1200);
      return;
    }
    if (swRegistration?.waiting) {
      swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
      window.setTimeout(() => window.location.reload(), 400);
      return;
    }
    window.location.reload();
  }, []);

  return {
    canInstall: installEvent !== null,
    isInstalled,
    isOffline,
    needsUpdate,
    updateStatus,
    promptInstall,
    applyUpdate,
    checkForUpdate,
  };
}
