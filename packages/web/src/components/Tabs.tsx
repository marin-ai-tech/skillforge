import { HelpTip } from "./HelpTip.tsx";

/** `content`: the label comes from a plugin (not the dictionary) and is not translated. */
type Tab = { id: string; label: string; testId: string; content?: boolean };

type Props = {
  tabs: Tab[];
  active: string;
  onChange: (id: string) => void;
};

export function Tabs({ tabs, active, onChange }: Props) {
  return (
    <div role="tablist" className="flex flex-wrap gap-1 border-b border-line">
      {tabs.map((t) => {
        const selected = t.id === active;
        return (
          <HelpTip key={t.id} family="tab-*">
            <button
              type="button"
              role="tab"
              data-testid={t.testId}
              aria-selected={selected}
              translate={t.content ? "no" : undefined}
              className={`-mb-px border-b-2 px-3 py-2 text-sm ${selected ? "border-accent text-ink font-medium" : "border-transparent text-muted hover:text-ink"}`}
              onClick={() => onChange(t.id)}
            >
              {t.label}
            </button>
          </HelpTip>
        );
      })}
    </div>
  );
}
