import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import type { ReactNode } from "react";
import { headT } from "@/i18n/head";

export const Route = createFileRoute("/help")({
  head: ({ matches }) => {
    const t = headT(matches);
    return {
      meta: [
        { title: t("help.metaTitle") },
        { name: "description", content: t("help.metaDescription") },
      ],
    };
  },
  component: HelpPage,
});

function HelpPage() {
  const { t } = useTranslation();
  const ordersLink = <Link to="/account" hash="my-orders" />;
  const topics: { q: string; a: ReactNode }[] = [
    {
      q: t("help.ordersQ"),
      a: <Trans t={t} i18nKey="help.ordersA" components={{ 1: ordersLink }} />,
    },
    {
      q: t("help.cancelQ"),
      a: <Trans t={t} i18nKey="help.cancelA" components={{ 1: <strong />, 3: ordersLink }} />,
    },
    { q: t("help.payQ"), a: t("help.payA") },
    { q: t("help.splitQ"), a: t("help.splitA") },
    {
      q: t("help.sellQ"),
      a: (
        <Trans
          t={t}
          i18nKey="help.sellA"
          components={{ 1: <Link to="/register" search={{ role: "seller" }} /> }}
        />
      ),
    },
  ];
  return (
    <main className="market-container pb-16">
      <div className="breadcrumb">
        <Link to="/">{t("home")}</Link>
        <ChevronRight className="rtl:-scale-x-100" />
        <span>{t("help.title")}</span>
      </div>
      <h1 className="page-title">{t("help.title")}</h1>
      <p className="page-subtitle">{t("help.subtitle")}</p>
      <div className="help-list mt-8">
        {topics.map((topic) => (
          <details key={topic.q} className="help-item">
            <summary>{topic.q}</summary>
            <p>{topic.a}</p>
          </details>
        ))}
      </div>
    </main>
  );
}
