import { createBrowserRouter } from "react-router-dom";
import App from "./App";
import { DockerLoader } from "./components/DockerLoader";
import { RequireAuth } from "./components/RequireAuth";
import { AuthLayout } from "./pages/AuthLayout";
import { Login } from "./pages/Login";
import { Register } from "./pages/Register";

const routeHydrateFallbackElement = <DockerLoader message="Loading page..." />;

export const router = createBrowserRouter([
  {
    Component: AuthLayout,
    children: [
      {
        path: "/login",
        Component: Login,
      },
      {
        path: "/register",
        Component: Register,
      },
    ],
  },
  {
    path: "/",
    Component: App,
    children: [
      {
        index: true,
        hydrateFallbackElement: routeHydrateFallbackElement,
        lazy: async () => {
          const m = await import("./pages/Landing");
          return {
            Component: () => (
              <RequireAuth>
                <m.Landing />
              </RequireAuth>
            ),
          };
        },
      },
      {
        path: "upload",
        hydrateFallbackElement: routeHydrateFallbackElement,
        lazy: async () => {
          const m = await import("./pages/FileUpload");
          return {
            Component: () => (
              <RequireAuth>
                <m.FileUpload />
              </RequireAuth>
            ),
          };
        },
      },
      {
        path: "analysis",
        hydrateFallbackElement: routeHydrateFallbackElement,
        lazy: async () => {
          const m = await import("./pages/AnalysisProgress");
          return {
            Component: () => (
              <RequireAuth>
                <m.AnalysisProgress />
              </RequireAuth>
            ),
          };
        },
      },
      {
        path: "analysis/batch",
        hydrateFallbackElement: routeHydrateFallbackElement,
        lazy: async () => {
          const m = await import("./pages/BatchAnalysisProgress");
          return {
            Component: () => (
              <RequireAuth>
                <m.BatchAnalysisProgress />
              </RequireAuth>
            ),
          };
        },
      },
      {
        path: "results",
        hydrateFallbackElement: routeHydrateFallbackElement,
        lazy: async () => {
          const m = await import("./pages/ResultsDashboard");
          return {
            Component: () => (
              <RequireAuth>
                <m.ResultsDashboard />
              </RequireAuth>
            ),
          };
        },
      },
      {
        path: "execution",
        hydrateFallbackElement: routeHydrateFallbackElement,
        lazy: async () => {
          const m = await import("./pages/ContainerExecution");
          return {
            Component: () => (
              <RequireAuth>
                <m.ContainerExecution />
              </RequireAuth>
            ),
          };
        },
      },
      {
        path: "research",
        hydrateFallbackElement: routeHydrateFallbackElement,
        lazy: async () => {
          const m = await import("./pages/ResearchAnalytics");
          return {
            Component: () => (
              <RequireAuth>
                <m.ResearchAnalytics />
              </RequireAuth>
            ),
          };
        },
      },
      {
        path: "scoring",
        hydrateFallbackElement: routeHydrateFallbackElement,
        lazy: async () => {
          const m = await import("./pages/ScoringGuide");
          return {
            Component: () => (
              <RequireAuth>
                <m.ScoringGuide />
              </RequireAuth>
            ),
          };
        },
      },
      {
        path: "history",
        hydrateFallbackElement: routeHydrateFallbackElement,
        lazy: async () => {
          const m = await import("./pages/History");
          return {
            Component: () => (
              <RequireAuth>
                <m.History />
              </RequireAuth>
            ),
          };
        },
      },
      {
        path: "project-upload",
        hydrateFallbackElement: routeHydrateFallbackElement,
        lazy: async () => {
          const m = await import("./pages/ProjectUpload");
          return {
            Component: () => (
              <RequireAuth>
                <m.ProjectUpload />
              </RequireAuth>
            ),
          };
        },
      },
      {
        path: "monitoring/:jobId/:containerId?",
        hydrateFallbackElement: routeHydrateFallbackElement,
        lazy: async () => {
          const m = await import("./pages/Monitoring");
          return {
            Component: () => (
              <RequireAuth>
                <m.Monitoring />
              </RequireAuth>
            ),
          };
        },
      },
      {
        path: "settings/api-keys",
        hydrateFallbackElement: routeHydrateFallbackElement,
        lazy: async () => {
          const m = await import("./pages/ApiKeys");
          return {
            Component: () => (
              <RequireAuth>
                <m.ApiKeys />
              </RequireAuth>
            ),
          };
        },
      },
    ],
  },
]);
