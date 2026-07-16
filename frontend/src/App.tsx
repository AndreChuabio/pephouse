import { Route, Routes } from "react-router-dom";
import LandingPage from "./pages/LandingPage";
import SimulationArenaPage from "./pages/SimulationArenaPage";
import Simulation2Page from "./pages/Simulation2Page";
import DataExplorerPage from "./pages/DataExplorerPage";
import DigitalTwinPage from "./pages/DigitalTwinPage";
import ConsultPage from "./pages/ConsultPage";
import CoordinatorPage from "./pages/CoordinatorPage";
import SettingsPage from "./pages/SettingsPage";
import VendorsPage from "./pages/VendorsPage";
import VendorSubmitPage from "./pages/VendorSubmitPage";
import VendorReviewPage from "./pages/VendorReviewPage";
import ReportPage from "./pages/ReportPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />

      {/* The product. */}
      <Route path="/explorer" element={<DataExplorerPage />} />
      <Route path="/vendors" element={<VendorsPage />} />
      <Route path="/vendors/submit" element={<VendorSubmitPage />} />
      <Route path="/report" element={<ReportPage />} />
      <Route path="/settings" element={<SettingsPage />} />

      {/* Operator surfaces. The backend refuses these to anyone not on ADMIN_EMAILS. */}
      <Route path="/review" element={<VendorReviewPage />} />
      <Route path="/coordinator" element={<CoordinatorPage />} />

      {/* Off the nav, routes kept so no existing link breaks. The Monte Carlo
          surfaces project outcome bands for compounds that have no completed
          trials behind them, and Consult is disabled on the backend because CVI
          bills real money per wall-clock minute. */}
      <Route path="/simulation-arena" element={<SimulationArenaPage />} />
      <Route path="/simulation-2" element={<Simulation2Page />} />
      <Route path="/digital-twin" element={<DigitalTwinPage />} />
      <Route path="/consult" element={<ConsultPage />} />
    </Routes>
  );
}
