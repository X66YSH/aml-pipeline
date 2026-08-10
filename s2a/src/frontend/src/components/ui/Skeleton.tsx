/**
 * Shimmer skeleton placeholders. Use <Skeleton /> for a single bar, or the
 * preset composites for common loading layouts.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded-lg ${className}`} />;
}

/** A card-shaped placeholder matching the project / stat card silhouette. */
export function SkeletonCard() {
  return (
    <div className="glass-card p-6 pt-7">
      <div className="flex items-start gap-3.5 mb-4">
        <Skeleton className="w-12 h-12 rounded-xl shrink-0" />
        <div className="flex-1 space-y-2 pt-1">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-16" />
        </div>
      </div>
      <Skeleton className="h-3 w-full mb-2" />
      <Skeleton className="h-3 w-2/3 mb-5" />
      <div className="flex items-center gap-4 pt-4 border-t border-slate-700/40">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-12" />
      </div>
    </div>
  );
}

/** A compact stat-tile placeholder. */
export function SkeletonStat() {
  return (
    <div className="glass-card p-4 flex items-center gap-3.5">
      <Skeleton className="w-11 h-11 rounded-xl shrink-0" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-5 w-12" />
        <Skeleton className="h-3 w-16" />
      </div>
    </div>
  );
}

/** Grid of skeleton cards for list/grid loading states. */
export function SkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
      {Array.from({ length: count }).map((_, i) => <SkeletonCard key={i} />)}
    </div>
  );
}
