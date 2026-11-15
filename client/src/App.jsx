import React, { Suspense, lazy, useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import "./App.css";

import Home from "./Pages/Home/Home";
import Dashboard from "./Pages/Dashboard/Dashboard";
import Login from "./Pages/Login/Login";
import Vault from "./Pages/Passwords/Passwords";
import Projects from "./Pages/Projects/Projects";
import ProjectDetail from "./Pages/Projects/ProjectDetail";
import ProjectForm from "./Pages/Projects/ProjectForm";
import ProjectDeploy from "./Pages/Projects/ProjectDeploy";
import Settings from "./Pages/Settings/Settings";
import Servers from "./Pages/Servers/Servers";
import Security from "./Pages/Security/Security";
// Loaded on demand: operations screens are large and only needed on their routes.
const PhotoImport = lazy(() => import("./Pages/PhotoCloud/PhotoImport"));
const SharedFolder = lazy(() => import("./Pages/PhotoCloud/SharedFolder"));
const Media = lazy(() => import("./Pages/Media/Media"));
const Admin = lazy(() => import("./Pages/Admin/Admin"));
const AppUpdates = lazy(() => import("./Pages/AppUpdates/AppUpdates"));
const Services = lazy(() => import("./Pages/Services/Services"));
const ServiceMap = lazy(() => import("./Pages/Services/ServiceMap"));
const Cron = lazy(() => import("./Pages/Cron/Cron"));
const SmartHome = lazy(() => import("./Pages/SmartHome/SmartHome"));
const WhatsAppSender = lazy(() => import("./Pages/WhatsApp/WhatsAppSender"));
const SmsSender = lazy(() => import("./Pages/Sms/SmsSender"));
const Money = lazy(() => import("./Pages/Money/Money"));
const Forgot = lazy(() => import("./Pages/Forgot/Forgot"));
const RenderDashboard = lazy(() => import("./Pages/Render/RenderDashboard"));
const SecurityCenter = lazy(() => import("./Pages/SecurityCenter/SecurityCenter"));
const Generator = lazy(() => import("./Pages/Generator/Generator"));
import Privacy from "./Pages/Privacy/Privacy";
import Apps from "./Pages/Apps/Apps";
import Logout from "./Pages/Logout/Logout";
import PhotoCloud from "./Pages/PhotoCloud/PhotoCloud";
import PhotoShare from "./Pages/PhotoCloud/PhotoShare";
import Navbar from "./Components/Navbar/Navbar";
import InstallPrompt from "./Components/InstallPrompt/InstallPrompt";
import CommandPalette from "./Components/CommandPalette/CommandPalette";
import SkyFx from "./Components/SkyFx/SkyFx";
import JungleScene from "./Components/Jungle/JungleScene";
import InfraTabs from "./Components/InfraTabs/InfraTabs";
import NetBar from "./Components/NetBar/NetBar";
import Splash from "./Components/Splash/Splash";
import BottomNav from "./Components/BottomNav/BottomNav";
import Sidebar from "./Components/AppShell/Sidebar";
import { useVault } from "./state/vault";

const WAKING = { title: "Waking the server…", body: "Your sign-in is saved. Free servers sleep when idle and can take up to a minute to start." };

function RequireVault({ children }) {
  const { status, waking } = useVault();
  const location = useLocation();
  if (status === "checking") return <Splash {...(waking ? WAKING : {})} />;
  if (status === "signedOut") return <Navigate to="/signin" replace state={{ from: location.pathname }} />;
  return children;
}

function RequireFeature({ feature, children }) {
  const { profile } = useVault();
  return profile?.features?.[feature] ? children : <Navigate to="/passwords" replace />;
}

function RequireAdmin({ children }) {
  const { profile } = useVault();
  return profile?.isAdmin ? children : <Navigate to="/passwords" replace />;
}

function GuestOnly({ children }) {
  const { status, waking } = useVault();
  if (status === "checking") return <Splash {...(waking ? WAKING : {})} />;
  if (status === "ready") return <Navigate to="/passwords" replace />;
  return children;
}

/* The marketing page is for visitors; signed-in people land on their overview. */
function HomeOrDashboard() {
  const { status } = useVault();
  if (status === "ready" || status === "locked") return <Navigate to="/dashboard" replace />;
  return <Home />;
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  // Photos keeps its pre-redesign look: styles/system.css skips body.route-photos.
  useEffect(() => {
    document.body.classList.toggle("route-photos", pathname.startsWith("/photos") || pathname.startsWith("/share/photos"));
  }, [pathname]);
  return null;
}

function usePointerSpotlight() {
  useEffect(() => {
    const onMove = (e) => {
      const card = e.target.closest && e.target.closest(".card--hover");
      if (!card) return;
      const rect = card.getBoundingClientRect();
      card.style.setProperty("--px", `${e.clientX - rect.left}px`);
      card.style.setProperty("--py", `${e.clientY - rect.top}px`);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);
}

export default function App() {
  usePointerSpotlight();
  return (
    <div className="App">
      <BrowserRouter>
        <a className="skip-link" href="#main">Skip to content</a>
        <ScrollToTop />
        <NetBar />
        <CommandPalette />
        <JungleScene />
        <SkyFx />
        <Navbar />
        <Sidebar />
        <ToastContainer position="top-right" autoClose={3500} newestOnTop closeOnClick pauseOnHover draggable theme="colored" />
        <div id="main" tabIndex={-1} className="app-main">
        <Routes>
          <Route path="/" element={<HomeOrDashboard />} />
          <Route path="/dashboard" element={<RequireVault><Dashboard /></RequireVault>} />
          <Route path="/signin" element={<GuestOnly><Login /></GuestOnly>} />
          <Route path="/forgot-password" element={<GuestOnly><Suspense fallback={<Splash />}><Forgot /></Suspense></GuestOnly>} />
          <Route path="/signup" element={<Navigate to="/signin" replace />} />
          <Route path="/passwords" element={<RequireVault><Vault /></RequireVault>} />
          <Route path="/photos" element={<RequireVault><RequireFeature feature="photos"><PhotoCloud /></RequireFeature></RequireVault>} />
          <Route path="/photos/import" element={<RequireVault><RequireFeature feature="photoImport"><Suspense fallback={<Splash />}><PhotoImport /></Suspense></RequireFeature></RequireVault>} />
          <Route path="/photos/shared/:id" element={<RequireVault><RequireFeature feature="photos"><Suspense fallback={<Splash />}><SharedFolder /></Suspense></RequireFeature></RequireVault>} />
          <Route path="/admin" element={<RequireVault><RequireFeature feature="adminPanel"><Suspense fallback={<Splash />}><Admin /></Suspense></RequireFeature></RequireVault>} />
          <Route path="/share/photos/:token" element={<PhotoShare />} />
          <Route path="/projects" element={<RequireVault><Projects /></RequireVault>} />
          <Route path="/projects/new" element={<RequireVault><ProjectForm /></RequireVault>} />
          <Route path="/projects/deploy" element={<RequireVault><ProjectDeploy /></RequireVault>} />
          <Route path="/projects/:id" element={<RequireVault><ProjectDetail /></RequireVault>} />
          <Route path="/projects/:id/edit" element={<RequireVault><ProjectForm /></RequireVault>} />
          <Route path="/settings" element={<RequireVault><Settings /></RequireVault>} />
          <Route path="/generator" element={<RequireVault><Suspense fallback={<Splash />}><Generator /></Suspense></RequireVault>} />
          <Route path="/money" element={<RequireVault><Suspense fallback={<Splash />}><Money /></Suspense></RequireVault>} />
          <Route path="/smart-home" element={<RequireVault><Suspense fallback={<Splash />}><SmartHome /></Suspense></RequireVault>} />
          <Route path="/whatsapp" element={<RequireVault><Suspense fallback={<Splash />}><WhatsAppSender /></Suspense></RequireVault>} />
          <Route path="/sms" element={<RequireVault><Suspense fallback={<Splash />}><SmsSender /></Suspense></RequireVault>} />
          <Route path="/security-center" element={<RequireVault><Suspense fallback={<Splash />}><SecurityCenter /></Suspense></RequireVault>} />
          <Route path="/app-updates" element={<RequireVault><RequireAdmin><Suspense fallback={<Splash />}><AppUpdates /></Suspense></RequireAdmin></RequireVault>} />
          <Route path="/servers" element={<RequireVault><RequireAdmin><Servers /></RequireAdmin></RequireVault>} />
          <Route path="/media" element={<RequireVault><RequireAdmin><Suspense fallback={<Splash />}><Media /></Suspense></RequireAdmin></RequireVault>} />
          <Route path="/security" element={<RequireVault><RequireAdmin><Security /></RequireAdmin></RequireVault>} />
          <Route element={<RequireVault><InfraTabs /></RequireVault>}>
            <Route path="/services/map" element={<Suspense fallback={<Splash />}><ServiceMap /></Suspense>} />
            <Route path="/services" element={<Suspense fallback={<Splash />}><Services /></Suspense>} />
            <Route path="/cron" element={<Suspense fallback={<Splash />}><Cron /></Suspense>} />
            <Route path="/render" element={<Suspense fallback={<Splash />}><RenderDashboard /></Suspense>} />
          </Route>
          <Route path="/apps" element={<Apps />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/logout" element={<Logout />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </div>
        <InstallPrompt />
        <BottomNav />
      </BrowserRouter>
    </div>
  );
}
