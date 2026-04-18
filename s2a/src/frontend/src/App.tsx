import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Sidebar from './components/layout/Sidebar';
import HomePage from './pages/HomePage';
import ProjectsPage from './pages/ProjectsPage';
import ProjectDetailPage from './pages/ProjectDetailPage';
import DataPage from './pages/DataPage';
import SettingsPage from './pages/SettingsPage';

export default function App() {
  return (
    <BrowserRouter>
      <div className="h-screen w-screen flex overflow-hidden">
        <Sidebar />
        <main className="flex-1 min-w-0 bg-[var(--color-bg)] overflow-y-auto">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/projects/:id" element={<ProjectDetailPage />} />
            <Route path="/data" element={<DataPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
