import { formatRelativeTime } from "../lib/format.ts";

type Props = { iso: string };

export function RelativeTime({ iso }: Props) {
  return (
    <time dateTime={iso} title={iso} className="text-muted">
      {formatRelativeTime(iso)}
    </time>
  );
}
