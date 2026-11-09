import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

const WIDE = "(min-width: 1024px)";

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/**
 * Keeps the element's height in a CSS variable on `<html>` while `active` (`0px` otherwise and after unmount), so
 * other pinned parts can sit below it: `--sf-header-h` (app header), `--sf-bar-h` (page toolbar).
 */
export function useHeightVar(
  ref: RefObject<HTMLElement | null>,
  name: string,
  active = true,
): void {
  useLayoutEffect(() => {
    const root = document.documentElement.style;
    const el = ref.current;
    if (!el || !active) {
      root.setProperty(name, "0px");
      return;
    }
    const write = () => root.setProperty(name, `${el.offsetHeight}px`);
    write();
    const ro = new ResizeObserver(write);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.setProperty(name, "0px");
    };
  }, [ref, name, active]);
}

/** Page toolbar (title, search, filters) pinned under the app header on wide screens. */
export function StickyBar({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const pinned = useMediaQuery(WIDE);
  useHeightVar(ref, "--sf-bar-h", pinned);
  return (
    <div
      ref={ref}
      data-testid="sticky-bar"
      className="space-y-4 border-b border-line bg-bg pb-3 lg:sticky lg:top-[var(--sf-header-h)] lg:z-30 lg:pt-3"
    >
      {children}
    </div>
  );
}
