import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import Analytics from './pages/Analytics';
import Settings from './pages/Settings';
import { SiteSelectionProvider } from './lib/siteSelection';

export default function App() {
  return (
    <SiteSelectionProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/settings" replace />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="*" element={<Navigate to="/settings" replace />} />
        </Route>
      </Routes>
    </SiteSelectionProvider>
  );
}
