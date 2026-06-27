import { Navigate, Route, Routes } from "react-router-dom";
import SimulationArenaPage from "./pages/SimulationArenaPage";
import Simulation2Page from "./pages/Simulation2Page";
import DataExplorerPage from "./pages/DataExplorerPage";
import DigitalTwinPage from "./pages/DigitalTwinPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/explorer" replace />} />
      <Route path="/simulation-arena" element={<SimulationArenaPage />} />
      <Route path="/simulation-2" element={<Simulation2Page />} />
      <Route path="/digital-twin" element={<DigitalTwinPage />} />
      <Route path="/explorer" element={<DataExplorerPage />} />
    </Routes>
  );
}
