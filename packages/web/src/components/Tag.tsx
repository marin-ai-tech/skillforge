import { Link } from "react-router";

type Props = { tag: string; to?: string; onClick?: () => void };

export function Tag({ tag, to, onClick }: Props) {
  const className =
    "inline-flex items-center rounded-sf border border-line bg-surface-2 px-1.5 py-0.5 text-xs text-ink-2 hover:border-accent";
  if (to) {
    return (
      <Link to={to} translate="no" className={className} onClick={onClick}>
        {tag}
      </Link>
    );
  }
  return (
    <span translate="no" className={className} onClick={onClick}>
      {tag}
    </span>
  );
}
