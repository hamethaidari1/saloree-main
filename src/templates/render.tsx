import type { TemplateData } from "./data";
import type { TemplateDefinition } from "./registry";
import type { ThemeSettings } from "./settings";
import type { TemplateProps } from "./types";

/**
 * The ONE way a store template is rendered — by the live storefront, the
 * Themes library miniatures and the Customize preview alike. Same component,
 * same merged settings: what the seller sees is what shoppers get.
 */
export function TemplateView({
  template,
  settings,
  data,
  mode,
}: {
  template: TemplateDefinition;
  settings: ThemeSettings;
  data: TemplateData;
  mode: TemplateProps["mode"];
}) {
  const Storefront = template.Storefront;
  return <Storefront {...data} settings={settings} mode={mode} />;
}
