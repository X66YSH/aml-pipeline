import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import Sidebar from './components/layout/Sidebar';
import AuroraBackground from './components/layout/AuroraBackground';
import CursorSpotlight from './components/layout/CursorSpotlight';
import { ToastProvider } from './components/ui/Toast';
import CommandPalette from './components/ui/CommandPalette';
import ScrollProgress from './components/ui/ScrollProgress';
import HomePage from './pages/HomePage';
import ProjectsPage from './pages/ProjectsPage';
import ProjectDetailPage from './pages/ProjectDetailPage';
import DataPage from './pages/DataPage';
import SettingsPage from './pages/SettingsPage';

/** Routes with an opacity-only cross-fade on navigation. Opacity (unlike
 *  transform) creates no containing block, so sticky headers & fixed modals
 *  inside pages keep working. */
function AnimatedRoutes() {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="h-full"
      >
        <Routes location={location}>
          <Route path="/" element={<HomePage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
          <Route path="/data" element={<DataPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </motion.div>
    </AnimatePresence>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuroraBackground />
        <CursorSpotlight />
        <ScrollProgress />
        <CommandPalette />
        <div className="relative z-10 h-screen w-screen flex overflow-hidden">
          <Sidebar />
          <main className="flex-1 min-w-0 overflow-y-auto">
            <AnimatedRoutes />
          </main>
        </div>
      </ToastProvider>
    </BrowserRouter>
  );
}
