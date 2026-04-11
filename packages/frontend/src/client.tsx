import "./styles.css";
import { createRoot } from "react-dom/client";
import App from "./app";
import { Providers } from "@/providers";

const root = createRoot(document.getElementById("app")!);

root.render(
  <Providers>
    <div className="panel-page text-base antialiased transition-colors selection:bg-cyan-300/60 selection:text-neutral-900">
      <App />
    </div>
  </Providers>
);
