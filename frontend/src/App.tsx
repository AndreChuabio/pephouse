import { Navigate, Route, Routes } from "react-router-dom";
import SimulationArenaPage from "./pages/SimulationArenaPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/simulation-arena" replace />} />
      <Route path="/simulation-arena" element={<SimulationArenaPage />} />
    </Routes>
  );
}
