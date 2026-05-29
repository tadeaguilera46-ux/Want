import { useCallback, useEffect, useRef, useState } from "react";

type WakeLockSentinelLike = {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (
    type: "release",
    listener: () => void
  ) => void;
};

type NavigatorWithWakeLock = Navigator & {
  wakeLock?: {
    request: (type: "screen") => Promise<WakeLockSentinelLike>;
  };
};

export function useWakeLock(enabled = true) {
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);
  const [isWakeLockActive, setIsWakeLockActive] = useState(false);
  const [isWakeLockSupported, setIsWakeLockSupported] = useState(() => {
    if (typeof navigator === "undefined") return false;
    return "wakeLock" in navigator;
  });

  const requestWakeLock = useCallback(async () => {
    const nav = navigator as NavigatorWithWakeLock;

    if (!enabled || !nav.wakeLock) {
      setIsWakeLockActive(false);
      return;
    }

    try {
      const wakeLock = await nav.wakeLock.request("screen");

      wakeLock.addEventListener("release", () => {
        wakeLockRef.current = null;
        setIsWakeLockActive(false);
      });

      wakeLockRef.current = wakeLock;
      setIsWakeLockActive(true);
    } catch (error) {
      console.warn("Wake Lock no disponible:", error);
      setIsWakeLockActive(false);
    }
  }, [enabled]);

  const releaseWakeLock = useCallback(async () => {
    if (!wakeLockRef.current || wakeLockRef.current.released) return;

    try {
      await wakeLockRef.current.release();
    } catch (error) {
      console.warn("No se pudo liberar Wake Lock:", error);
    } finally {
      wakeLockRef.current = null;
      setIsWakeLockActive(false);
    }
  }, []);

  useEffect(() => {
    setIsWakeLockSupported(
      typeof navigator !== "undefined" && "wakeLock" in navigator
    );
  }, []);

  useEffect(() => {
    if (!enabled) {
      void releaseWakeLock();
      return;
    }

    void requestWakeLock();

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void requestWakeLock();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      void releaseWakeLock();
    };
  }, [enabled, requestWakeLock, releaseWakeLock]);

  return {
    isWakeLockActive,
    isWakeLockSupported,
    requestWakeLock,
    releaseWakeLock,
  };
}