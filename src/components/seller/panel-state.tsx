import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { friendlyError } from "@/services/seller";

/** Loading / error / empty handling shared by the seller tabs. */
export function PanelState<T>({
  query,
  errorText,
  empty,
  children,
}: {
  query: UseQueryResult<T[]>;
  errorText: string;
  empty: { title: string; description: string };
  children: (data: T[]) => ReactNode;
}) {
  if (query.isPending)
    return (
      <div className="seller-skeleton" aria-label="Loading" aria-busy="true">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} />
        ))}
      </div>
    );
  if (query.isError)
    return (
      <div role="alert" className="seller-empty">
        <h3>{errorText}</h3>
        <p>{friendlyError(query.error)}</p>
        <Button variant="outline" size="sm" onClick={() => query.refetch()}>
          Try again
        </Button>
      </div>
    );
  if (!query.data.length)
    return (
      <div className="seller-empty">
        <h3>{empty.title}</h3>
        <p>{empty.description}</p>
      </div>
    );
  return <>{children(query.data)}</>;
}
