import { useState } from "react";
import { Check, ChevronDown, MapPin } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { COUNTRIES, useCountry, type CountryCode } from "@/lib/country";

/** The country buttons; shared by the header popover and the mobile drawer. */
export function CountryList({ onSelect }: { onSelect?: (code: CountryCode) => void }) {
  const { country, setCountry } = useCountry();
  return (
    <ul className="grid gap-0.5" aria-label="Delivery countries">
      {COUNTRIES.map((c) => {
        const selected = country?.code === c.code;
        return (
          <li key={c.code}>
            <button
              type="button"
              className="nav-panel-link"
              aria-pressed={selected}
              onClick={() => {
                setCountry(c.code);
                onSelect?.(c.code);
              }}
            >
              {c.name}
              {selected && <Check size={15} aria-hidden />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * "Deliver to" control. `block` = two-line block in the desktop header row;
 * `strip` = one line ("Deliver to Turkey ⌄") in the mobile strip.
 */
export function DeliverTo({ variant = "block" }: { variant?: "block" | "strip" }) {
  const { country, ready } = useCountry();
  const [open, setOpen] = useState(false);
  const name = country?.name ?? (ready ? "Choose country" : "…");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={variant === "strip" ? "nav-hit nav-strip-hit" : "nav-hit"}
        aria-label={`Deliver to ${country?.name ?? "no country selected"}. Change delivery country`}
      >
        {variant === "strip" ? (
          <>
            <MapPin size={18} aria-hidden className="shrink-0" />
            <span className="truncate">
              Deliver to <span className="font-semibold">{name}</span>
            </span>
            <ChevronDown size={15} aria-hidden className="shrink-0" />
          </>
        ) : (
          <>
            <MapPin size={18} aria-hidden className="mt-2 shrink-0" />
            <span className="text-start">
              <span className="nav-small">Deliver to</span>
              <span className="nav-strong">{name}</span>
            </span>
          </>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3">
        <h2 className="mb-1 px-2 text-sm font-semibold">Choose your delivery country</h2>
        <p className="mb-2 px-2 text-xs text-muted-foreground">
          We'll use it to show delivery details at checkout.
        </p>
        <CountryList onSelect={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
