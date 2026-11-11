import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, Trash2, Store, ArrowRight, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCart } from "@/components/marketplace/cart-context";
import { cartTotal } from "@/services/cart";
import { money } from "@/services/catalog";
import {
  QuantityPicker,
  EmptyState,
  CatalogSkeleton,
  useCatalog,
} from "@/components/marketplace/shared";
import { toast } from "sonner";
export const Route = createFileRoute("/cart")({
  head: () => ({
    meta: [
      { title: "Your Shopping Bag — Saloree" },
      {
        name: "description",
        content:
          "Your favorite Saloree finds, together in one shared cart, grouped by independent store.",
      },
      { property: "og:title", content: "Your Shopping Bag — Saloree" },
      { property: "og:description", content: "All your favorite finds. One shared shopping bag." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CartPage,
});
function CartPage() {
  const { items, ready, setQuantity } = useCart();
  const { stores, products } = useCatalog();
  const total = cartTotal(items, products);
  return (
    <main className="market-container">
      <div className="breadcrumb">
        <Link to="/">Home</Link>
        <ChevronRight />
        <span>Your shopping bag</span>
      </div>
      <h1 className="page-title">Your shopping bag</h1>
      <p className="page-subtitle">A few good finds, all in one place.</p>
      {!ready ? (
        <CatalogSkeleton />
      ) : !items.length ? (
        <EmptyState
          title="Good things are waiting"
          description="Your bag is empty. Let’s find something you love."
        />
      ) : (
        <div className="cart-layout">
          <div>
            {stores
              .filter((s) =>
                items.some((i) => products.find((p) => p.id === i.productId)?.storeSlug === s.slug),
              )
              .map((store) => (
                <section key={store.slug} className="cart-store-group">
                  <Link
                    to="/store/$slug"
                    params={{ slug: store.slug }}
                    className="cart-store-heading"
                  >
                    <Store size={16} />
                    {store.name}
                    <ChevronRight size={13} />
                  </Link>
                  {items.map((item) => {
                    const p = products.find((p) => p.id === item.productId);
                    if (!p || p.storeSlug !== store.slug) return null;
                    return (
                      <article key={p.id} className="cart-line">
                        <Link to="/product/$id" params={{ id: p.id }}>
                          <img src={p.image} alt={p.title} width="105" height="105" />
                        </Link>
                        <div className="min-w-0">
                          <Link to="/product/$id" params={{ id: p.id }}>
                            <h3>{p.title}</h3>
                          </Link>
                          <p>{money(p.price)} each</p>
                          <QuantityPicker
                            value={item.quantity}
                            max={p.stock}
                            onChange={(q) => setQuantity(p.id, q)}
                          />
                        </div>
                        <div className="cart-line-end">
                          <strong>{money(p.price * item.quantity)}</strong>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`Remove ${p.title}`}
                            title="Remove item"
                            onClick={() => {
                              setQuantity(p.id, 0);
                              toast.success("Removed from your bag");
                            }}
                          >
                            <Trash2 size={15} />
                          </Button>
                        </div>
                      </article>
                    );
                  })}
                </section>
              ))}
            <Link
              to="/products"
              className="text-xs inline-flex items-center gap-2 text-primary mt-3"
            >
              Continue discovering
              <ArrowRight size={14} />
            </Link>
          </div>
          <aside className="order-summary">
            <h2>Order summary</h2>
            <div className="summary-row">
              <span>Subtotal ({items.reduce((s, i) => s + i.quantity, 0)} items)</span>
              <strong>{money(total)}</strong>
            </div>
            <div className="summary-row text-muted-foreground">
              <span>Shipping</span>
              <span>Calculated at checkout</span>
            </div>
            <div className="summary-row summary-total">
              <span>Subtotal</span>
              <span>{money(total)}</span>
            </div>
            <Button asChild className="w-full h-11 mt-4">
              <Link to="/checkout">
                Continue to checkout
                <ArrowRight />
              </Link>
            </Button>
            <p className="checkout-note">
              Pay on delivery. Final prices are confirmed when you place your order.
            </p>
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground mt-5">
              <ShieldCheck size={14} />
              Independent stores. One shared bag.
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}
