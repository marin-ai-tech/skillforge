import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router";
import { resolvePageTopic } from "./registry.ts";

type HelpContextValue = {
  open: boolean;
  current: string | null;
  openTopic: (topicId: string) => void;
  close: () => void;
  toggle: (topicId?: string) => void;
  back: () => void;
  canBack: boolean;
};

const HelpContext = createContext<HelpContextValue | null>(null);

export function HelpProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);

  const openTopic = useCallback((topicId: string) => {
    setCurrent((prev) => {
      if (prev && prev !== topicId) {
        setHistory((h) => [...h, prev]);
      }
      return topicId;
    });
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  const toggle = useCallback(
    (topicId?: string) => {
      const id = topicId ?? resolvePageTopic(location.pathname);
      setOpen((was) => {
        if (was) return false;
        setCurrent(id);
        setHistory([]);
        return true;
      });
    },
    [location.pathname],
  );

  const back = useCallback(() => {
    setHistory((h) => {
      if (h.length === 0) return h;
      const next = [...h];
      const prev = next.pop()!;
      setCurrent(prev);
      return next;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isHelpKey =
        e.key === "?" || (e.code === "Slash" && e.shiftKey) || (e.key === "/" && e.shiftKey);
      if (!isHelpKey) return;
      const t = e.target as HTMLElement | null;
      if (!t) return;
      const tag = t.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (t.isContentEditable) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  const value = useMemo<HelpContextValue>(
    () => ({
      open,
      current,
      openTopic,
      close,
      toggle,
      back,
      canBack: history.length > 0,
    }),
    [open, current, openTopic, close, toggle, back, history.length],
  );

  return <HelpContext.Provider value={value}>{children}</HelpContext.Provider>;
}

export function useHelp(): HelpContextValue {
  const ctx = useContext(HelpContext);
  if (!ctx) throw new Error("useHelp must be used within HelpProvider");
  return ctx;
}
