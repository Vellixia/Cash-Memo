"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { Segmented } from "@/components/segmented";
import { useAppearance } from "@/lib/appearance";

export const THEMES = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;
type Theme = (typeof THEMES)[number]["value"];

/** Light / Dark / System. Renders only after mount: the stored theme is unknown on the server. */
export function ThemeSelect() {
  const { theme, setTheme } = useAppearance();
  return (
    <Segmented<Theme>
      label="Theme"
      className="flex w-full"
      value={theme as Theme}
      onChange={setTheme}
      options={THEMES.map(({ value, label, icon: Icon }) => ({
        value,
        label: (
          <>
            <Icon className="size-4" /> {label}
          </>
        ),
      }))}
    />
  );
}
