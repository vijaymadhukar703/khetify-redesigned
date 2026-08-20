import { useEffect } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

export default function ScrollToTop() {
  const { pathname, hash } = useLocation();
  const navigationType = useNavigationType(); // "PUSH" | "REPLACE" | "POP"

  useEffect(() => {
    // Back / forward — let the browser put them back where they were.
    if (navigationType === "POP") return;

    const html = document.documentElement;
    const previous = html.style.scrollBehavior;
    html.style.scrollBehavior = "auto"; // beat the smooth rule in index.css

    // A link to /page#section wants that section, not the top of the page.
    if (hash) {
      const target = document.querySelector(hash);
      if (target) {
        target.scrollIntoView();
        html.style.scrollBehavior = previous;
        return;
      }
    }

    window.scrollTo(0, 0);
    html.style.scrollBehavior = previous;
  }, [pathname, hash, navigationType]);

  return null;
}