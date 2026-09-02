import React from "react";
import { createRoot } from "react-dom/client";
import { ConvexReactClient, ConvexProvider } from "convex/react";
import App from "./App";
import "./index.css";

const convexUrl = import.meta.env.VITE_CONVEX_URL || "http://127.0.0.1:3210";
const convex = new ConvexReactClient(convexUrl);

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConvexProvider client={convex}>
      <App />
    </ConvexProvider>
  </React.StrictMode>
);
