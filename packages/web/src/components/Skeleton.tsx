type Props = { className?: string };

export function Skeleton({ className = "" }: Props) {
  return <div className={`animate-pulse rounded-sf bg-surface-2 ${className}`} aria-hidden />;
}
