import { NavLink, Outlet } from 'react-router-dom';

const NAV_ITEMS = [
  { to: '/settings', label: 'Settings' },
  { to: '/analytics', label: 'Analytics' },
];

export default function Layout() {
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
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
