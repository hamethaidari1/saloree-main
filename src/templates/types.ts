import type { TemplateData } from "./data";
import type { ThemeSettings } from "./settings";

/** The single input every template renders from. */
export interface TemplateProps extends TemplateData {
  /** Already merged over the template defaults (see mergeSettings). */
  settings: ThemeSettings;
  /** "preview" = inside the editor/library (inert links); same markup otherwise. */
  mode: "live" | "preview";
}
