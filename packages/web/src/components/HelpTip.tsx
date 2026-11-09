import {
  cloneElement,
  useCallback,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useHelp } from "../help/HelpProvider.tsx";
import { ACTION_HELP, type Action } from "../help/registry.ts";
import { STR } from "../lib/strings.ts";

type Props = {
  action?: Action;
  family?: Action;
  children: ReactElement;
};

type TipPos = { top: number; left: number };

export function HelpTip({ action, family, children }: Props) {
  const key = (family ?? action)!;
  const entry = ACTION_HELP[key];
  const tipText = entry?.tip ?? "";
  const topic = entry?.topic;
  const { openTopic } = useHelp();
  const reactId = useId();
  const tipDomId = `help-tip-${reactId.replace(/:/g, "")}`;
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<TipPos>({ top: 0, left: 0 });
  const hideTimer = useRef<number | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);

  const clearHide = () => {
    if (hideTimer.current != null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  };

  const showFrom = useCallback((el: HTMLElement) => {
    clearHide();
    const rect = el.getBoundingClientRect();
    const tipH = 96;
    let top = rect.bottom + 8;
    if (top + tipH > window.innerHeight) {
      top = Math.max(8, rect.top - tipH - 8);
    }
    setPos({
      top,
      left: Math.min(Math.max(8, rect.left), window.innerWidth - 280),
    });
    setVisible(true);
  }, []);

  const scheduleHide = useCallback(() => {
    clearHide();
    hideTimer.current = window.setTimeout(() => setVisible(false), 200);
  }, []);

  const child = children as ReactElement<{
    title?: string;
    "aria-describedby"?: string;
    onFocus?: (e: FocusEvent) => void;
    onBlur?: (e: FocusEvent) => void;
    className?: string;
  }>;

  const merged = cloneElement(child, {
    title: tipText || child.props.title,
    "aria-describedby": tipDomId,
    onFocus: (e: FocusEvent) => {
      child.props.onFocus?.(e);
      showFrom(e.currentTarget as HTMLElement);
    },
    onBlur: (e: FocusEvent) => {
      child.props.onBlur?.(e);
      scheduleHide();
    },
  });

  const childClass = child.props.className ?? "";
  const wrapperClass = childClass.includes("w-full")
    ? "block w-full"
    : childClass.includes("flex-1")
      ? "block min-w-0 flex-1"
      : "inline-flex max-w-full";

  let portal: ReactNode = null;
  if (visible && typeof document !== "undefined") {
    portal = createPortal(
      <div
        id={tipDomId}
        data-testid="help-tip"
        role="tooltip"
        className="pointer-events-none z-[80] max-w-xs rounded-sf border border-line bg-surface px-3 py-2 text-sm text-ink shadow-sm"
        style={{ position: "fixed", top: pos.top, left: pos.left }}
        onMouseEnter={clearHide}
        onMouseLeave={scheduleHide}
      >
        <div>{tipText}</div>
        {topic ? (
          <button
            type="button"
            data-testid="help-tip-more"
            className="pointer-events-auto mt-1 text-sm text-accent underline"
            onMouseEnter={clearHide}
            onClick={() => {
              clearHide();
              setVisible(false);
              openTopic(topic);
            }}
          >
            {STR.tips.help.learnMore}
          </button>
        ) : null}
      </div>,
      document.body,
    );
  }

  return (
    <>
      <span
        ref={wrapRef}
        className={wrapperClass}
        onMouseEnter={() => {
          if (wrapRef.current) showFrom(wrapRef.current);
        }}
        onMouseLeave={scheduleHide}
      >
        {merged}
      </span>
      {portal}
    </>
  );
}
