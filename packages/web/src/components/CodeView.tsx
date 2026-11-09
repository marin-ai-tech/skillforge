type Props = { text: string };

export function CodeView({ text }: Props) {
  return (
    <pre
      translate="no"
      className="overflow-auto whitespace-pre-wrap break-words rounded-sf border border-line bg-surface-2 p-3 font-mono text-[13px] text-ink"
    >
      {text}
    </pre>
  );
}
