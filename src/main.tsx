import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

const convexUrl = import.meta.env.VITE_CONVEX_URL || "http://127.0.0.1:3210";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App convexUrl={convexUrl} />
  </React.StrictMode>
);
