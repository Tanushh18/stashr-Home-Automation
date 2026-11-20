import { useEffect, useState } from "react";

const read = () => (typeof document !== "undefined" && document.documentElement.getAttribute("data-theme")) || "dark";

/** Follows the light/dark switch (read-only; useTheme owns writing it). */
export default function useThemeName() {
  const [theme, setTheme] = useState(read);
  useEffect(() => {
    const obs = new MutationObserver(() => setTheme(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return theme === "light" ? "light" : "dark";
}
