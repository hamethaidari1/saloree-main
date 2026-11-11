import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { adminService } from "@/services/admin";
import { friendlyError } from "@/services/errors";
import { adminKeys } from "./keys";

const fmt = new Intl.NumberFormat("en-US");

function Tile({ label, value, detail }: { label: string; value: number; detail?: string }) {
  return (
    <div className="admin-tile">
      <span className="admin-tile-label">{label}</span>
      <strong className="admin-tile-value">{fmt.format(value)}</strong>
      {detail && <span className="admin-tile-detail">{detail}</span>}
    </div>
  );
}

export function OverviewPanel() {
  const q = useQuery({ queryKey: adminKeys.overview, queryFn: adminService.getOverview });
  if (q.isPending)
    return (
      <div className="admin-tiles" aria-busy="true" aria-label="Loading overview">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="admin-tile skeleton" />
        ))}
      </div>
    );
  if (q.isError)
    return (
      <div role="alert" className="seller-empty">
        <h3>The overview could not be loaded.</h3>
        <p>{friendlyError(q.error)}</p>
        <Button variant="outline" size="sm" onClick={() => q.refetch()}>
          Try again
        </Button>
      </div>
    );
  const d = q.data;
  return (
    <section aria-labelledby="overview-heading">
      <h2 id="overview-heading" className="sr-only">
        Overview
      </h2>
      <div className="admin-tiles">
        <Tile
          label="Stores"
          value={d.storesPublished + d.storesDraft}
          detail={`${fmt.format(d.storesPublished)} published · ${fmt.format(d.storesDraft)} draft`}
        />
        <Tile
          label="Products"
          value={d.productsActive + d.productsDraft}
          detail={`${fmt.format(d.productsActive)} active · ${fmt.format(d.productsDraft)} draft`}
        />
        <Tile label="Orders" value={d.orders} />
        <Tile label="Users" value={d.users} />
        <Tile label="Sellers" value={d.sellers} detail="Users with the seller role" />
      </div>
    </section>
  );
}
