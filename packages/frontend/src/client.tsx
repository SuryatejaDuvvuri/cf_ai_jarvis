import "./styles.css";
import { createRoot } from "react-dom/client";
import App from "./app";
import { Providers } from "@/providers";

document.documentElement.classList.add("dark");

const root = createRoot(document.getElementById("app")!);

root.render(
  <Providers>
    <div className="bg-neutral-950 text-base text-neutral-100 antialiased transition-colors selection:bg-blue-700 selection:text-white">
      <App />
    </div>
  </Providers>
);
