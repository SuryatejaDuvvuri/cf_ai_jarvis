import "./styles.css";
import { createRoot } from "react-dom/client";
import { useState, useEffect } from "react";
import App from "./app";
import Dashboard from "./views/dashboard";
import { Providers } from "@/providers";

document.documentElement.classList.add("dark");

function isDashboardRoute(): boolean {
  return (
    window.location.pathname === "/dashboard" ||
    window.location.hash === "#dashboard"
  );
}

function Root() {
  const [isDashboard, setIsDashboard] = useState(() => isDashboardRoute());

  useEffect(() => {
    const onRouteChange = () => setIsDashboard(isDashboardRoute());

    window.addEventListener("hashchange", onRouteChange);
    window.addEventListener("popstate", onRouteChange);

    return () => {
      window.removeEventListener("hashchange", onRouteChange);
      window.removeEventListener("popstate", onRouteChange);
    };
  }, []);

  return (
    <Providers>
      <div className="bg-neutral-950 text-base text-neutral-100 antialiased transition-colors selection:bg-blue-700 selection:text-white">
        {isDashboard ? <Dashboard /> : <App />}
      </div>
    </Providers>
  );
}

const root = createRoot(document.getElementById("app")!);
root.render(<Root />);
