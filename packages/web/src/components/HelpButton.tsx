import { CircleHelp } from "lucide-react";
import { useLocation } from "react-router";
import { useHelp } from "../help/HelpProvider.tsx";
import { ACTION_HELP, resolvePageTopic } from "../help/registry.ts";
import { HelpTip } from "./HelpTip.tsx";
import { STR } from "../lib/strings.ts";

type Props = { topic?: string };

export function HelpButton({ topic }: Props) {
  const { openTopic } = useHelp();
  const location = useLocation();
  const topicId = topic ?? resolvePageTopic(location.pathname);
  const tip = ACTION_HELP["help-button"].tip;

  return (
    <HelpTip action="help-button">
      <button
        type="button"
        data-testid="help-button"
        aria-label={STR.nav.help}
        title={tip}
        className="inline-flex items-center justify-center rounded-sf border border-line p-1.5 text-ink-2 hover:bg-surface-2"
        onClick={() => openTopic(topicId)}
      >
        <CircleHelp className="h-4 w-4" aria-hidden />
      </button>
    </HelpTip>
  );
}
