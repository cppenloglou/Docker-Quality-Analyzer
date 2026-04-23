import { createBrowserRouter } from "react-router-dom";
import App from "./App";
import { RequireAuth } from "./components/RequireAuth";

const routeHydrateFallbackElement = (
  <div className="min-h-screen bg-slate-950 text-slate-300 grid place-items-center">
    Loading...
  </div>
);

export const router = createBrowserRouter([
  {
    path: "/login",
    hydrateFallbackElement: routeHydrateFallbackElement,
    lazy: async () => {
      const m = await import("./pages/Login");
      return { Component: m.Login };
    },
  },
  {
    path: "/register",
    hydrateFallbackElement: routeHydrateFallbackElement,
    lazy: async () => {
      const m = await import("./pages/Register");
      return { Component: m.Register };
    },
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
        path: "image-build",
        hydrateFallbackElement: routeHydrateFallbackElement,
        lazy: async () => {
          const m = await import("./pages/ImageBuildProgress");
          return {
            Component: () => (
              <RequireAuth>
                <m.ImageBuildProgress />
              </RequireAuth>
            ),
          };
        },
      },
      {
        path: "image-analysis",
        hydrateFallbackElement: routeHydrateFallbackElement,
        lazy: async () => {
          const m = await import("./pages/ImageAnalysis");
          return {
            Component: () => (
              <RequireAuth>
                <m.ImageAnalysis />
              </RequireAuth>
            ),
          };
        },
      },
      {
        path: "runtime-monitoring",
        hydrateFallbackElement: routeHydrateFallbackElement,
        lazy: async () => {
          const m = await import("./pages/RuntimeMonitoring");
          return {
            Component: () => (
              <RequireAuth>
                <m.RuntimeMonitoring />
              </RequireAuth>
            ),
          };
        },
      },
      {
        path: "compose-monitoring",
        hydrateFallbackElement: routeHydrateFallbackElement,
        lazy: async () => {
          const m = await import("./pages/ComposeMonitoring");
          return {
            Component: () => (
              <RequireAuth>
                <m.ComposeMonitoring />
              </RequireAuth>
            ),
          };
        },
      },
    ],
  },
]);
