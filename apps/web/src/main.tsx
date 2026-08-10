import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { AppRouter } from "./app/router.js";

const rootElement = document.getElementById("root");
if (rootElement === null) throw new Error("ROOT_ELEMENT_MISSING");

createRoot(rootElement).render(
  <StrictMode>
    <AppRouter />
  </StrictMode>,
);
