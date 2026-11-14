import { MetricGridSkeleton } from '../agora-kit/blocks/metric-card';
import { Skeleton } from '../agora-kit/ui/skeleton';

const keys = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => `${prefix}-${index}`);

/** The document form while it loads: header with actions, then label + input pairs. */
export function EditSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-hidden>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-6 w-64 max-w-[60vw]" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-24" />
        </div>
      </div>
      <div className="flex max-w-[720px] flex-col gap-5">
        {keys('field', 5).map((key, index) => (
          <div key={key} className="flex flex-col gap-2">
            <Skeleton className="h-3 w-28" />
            <Skeleton className={index === 2 ? 'h-28 w-full' : 'h-9 w-full'} />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The whole console while the schema loads: the sidebar (brand, nav rows, footer), the topbar and a
 * dashboard-shaped body. The real shell needs the schema for its nav, so this stands in for it.
 */
export function BootSkeleton() {
  return (
    <div className="relative flex h-svh overflow-hidden" aria-busy="true">
      <div className="agora-glow" aria-hidden />
      <aside
        className="relative z-[1] hidden w-(--agora-sidebar-w) shrink-0 flex-col border-r border-border bg-sidebar md:flex"
        aria-hidden
      >
        <div className="flex items-center gap-2.5 border-b border-border px-[18px] pt-[18px] pb-3.5">
          <Skeleton className="size-[30px] rounded-md" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-2 w-14" />
          </div>
        </div>
        <div className="flex flex-col gap-2 px-4 pt-5">
          <Skeleton className="mb-1 h-2 w-16" />
          {keys('nav', 6).map((key) => (
            <Skeleton key={key} className="h-6 w-full" />
          ))}
        </div>
      </aside>
      <div className="relative z-[1] flex min-w-0 flex-1 flex-col">
        <div
          className="flex h-(--agora-topbar-h) items-center gap-3 border-b border-border px-5"
          aria-hidden
        >
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="ml-auto h-7 w-44" />
        </div>
        <div className="flex flex-col gap-4 px-4 pt-6 md:px-6" aria-hidden>
          <Skeleton className="h-5 w-36" />
          <MetricGridSkeleton count={4} />
          <Skeleton className="h-56 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}
