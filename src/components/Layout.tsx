import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { siteLabel } from '../lib/settings';
import { useSiteSelection } from '../lib/siteSelection';

const NAV_ITEMS = [
  { to: '/settings', label: 'Settings' },
  { to: '/analytics', label: 'Analytics' },
];

function SiteSwitcher() {
  const { sites, selectedSite, selectSite } = useSiteSelection();

  if (sites.length === 0) {
    return null;
  }

  return (
    <label className="topbar-site">
      <span className="topbar-site-label">サイト</span>
      <select
        className="input topbar-site-select"
        value={selectedSite?.id ?? ''}
        onChange={(event) => selectSite(event.target.value)}
      >
        {sites.map((site) => (
          <option key={site.id} value={site.id}>
            {siteLabel(site)}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function Layout() {
  const { pathname } = useLocation();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">GG</span>
          <span className="brand-text">GA4 GSC Unified</span>
        </div>
        <nav className="nav">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => (isActive ? 'nav-link is-active' : 'nav-link')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="main">
        <header className="topbar">
          <h1 className="topbar-title">GA4 GSC Unified</h1>
          {pathname === '/analytics' ? <SiteSwitcher /> : null}
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
