import { useEffect, useState } from "react";

/** Visible viewport, including the space left above a mobile soft keyboard. */
export function useMobileViewport(enabled = true) {
  const [viewport, setViewport] = useState<{
    top: number;
    height: number;
  } | null>(null);
  useEffect(() => {
    if (!enabled) {
      setViewport(null);
      return;
    }
    const visual = window.visualViewport;
    const update = () => {
      if (visual && visual.scale !== 1) return;
      setViewport(
        window.matchMedia("(max-width: 760px)").matches
          ? {
              top: visual?.offsetTop ?? 0,
              height: Math.round(visual?.height ?? window.innerHeight),
            }
          : null,
      );
    };
    update();
    window.addEventListener("resize", update);
    visual?.addEventListener("resize", update);
    visual?.addEventListener("scroll", update);
    return () => {
      window.removeEventListener("resize", update);
      visual?.removeEventListener("resize", update);
      visual?.removeEventListener("scroll", update);
    };
  }, [enabled]);
  return viewport;
}
