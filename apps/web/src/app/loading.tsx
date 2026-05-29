import { Card, Skeleton } from "@/components/ui";

/**
 * Route-level loading skeleton. Every page is force-dynamic and blocks on
 * serialized KS Fit fetches (plus a possible 402 token rotation) on a cold
 * cache, so this shows immediately on navigation instead of a frozen screen.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <div className="mb-6 space-y-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-9 w-64" />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="p-5">
            <Skeleton className="mb-3 h-3 w-20" />
            <Skeleton className="h-8 w-24" />
          </Card>
        ))}
      </div>

      <Card className="p-5">
        <Skeleton className="mb-4 h-4 w-40" />
        <Skeleton className="h-[260px] w-full" />
      </Card>
    </div>
  );
}
