import { Toaster } from "./components/ui/sonner";
import { useEffect } from "react";
import { Outlet } from "react-router-dom";

function App() {
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  return (
    <>
      <Outlet />
      <Toaster />
    </>
  );
}

export default App;
