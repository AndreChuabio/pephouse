import { Route, Routes } from "react-router-dom";
import LandingPage from "./pages/LandingPage";
import SimulationArenaPage from "./pages/SimulationArenaPage";
import Simulation2Page from "./pages/Simulation2Page";
import DataExplorerPage from "./pages/DataExplorerPage";
import DigitalTwinPage from "./pages/DigitalTwinPage";
import ConsultPage from "./pages/ConsultPage";
import CoordinatorPage from "./pages/CoordinatorPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/simulation-arena" element={<SimulationArenaPage />} />
      <Route path="/simulation-2" element={<Simulation2Page />} />
      <Route path="/digital-twin" element={<DigitalTwinPage />} />
      <Route path="/explorer" element={<DataExplorerPage />} />
      <Route path="/consult" element={<ConsultPage />} />
      <Route path="/coordinator" element={<CoordinatorPage />} />
    </Routes>
  );
}
