import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";

export const Route = createFileRoute("/help")({
  head: () => ({
    meta: [
      { title: "Customer Service — Saloree" },
      {
        name: "description",
        content: "Help with orders, cancellations, paying on delivery and selling on Saloree.",
      },
    ],
  }),
  component: HelpPage,
});

const TOPICS = [
  {
    q: "Where are my orders?",
    a: (
      <>
        Sign in and open{" "}
        <Link to="/account" hash="my-orders">
          My orders
        </Link>{" "}
        to see every order, its status and the store that's preparing it.
      </>
    ),
  },
  {
    q: "Can I cancel an order?",
    a: (
      <>
        Yes, while it's still <strong>pending</strong>. Use the Cancel button next to the order in{" "}
        <Link to="/account" hash="my-orders">
          My orders
        </Link>
        . Once a store starts processing it, it can no longer be cancelled online.
      </>
    ),
  },
  {
    q: "How do I pay?",
    a: "For now Saloree supports pay on delivery: you pay when your order arrives. Card and HesabPay payments are coming soon.",
  },
  {
    q: "I ordered from several stores — why are there several orders?",
    a: "Each independent store prepares and ships its own part, so one checkout creates one order per store. The confirmation page shows the total for all of them.",
  },
  {
    q: "How do I sell on Saloree?",
    a: (
      <>
        <Link to="/register" search={{ role: "seller" }}>
          Create a seller account
        </Link>
        , set up your store and add products. Your store goes live once it's been reviewed.
      </>
    ),
  },
];

function HelpPage() {
  return (
    <main className="market-container pb-16">
      <div className="breadcrumb">
        <Link to="/">Home</Link>
        <ChevronRight className="rtl:-scale-x-100" />
        <span>Customer Service</span>
      </div>
      <h1 className="page-title">Customer Service</h1>
      <p className="page-subtitle">Answers to the questions we hear most.</p>
      <div className="help-list mt-8">
        {TOPICS.map((t) => (
          <details key={t.q} className="help-item">
            <summary>{t.q}</summary>
            <p>{t.a}</p>
          </details>
        ))}
      </div>
    </main>
  );
}
