import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  Activity, BarChart3, GitFork, Bot, Cable, CircleDot, DoorOpen, Download, GitBranch, Hash, KeyRound,
  LayoutDashboard, LogOut, PanelLeftClose, PanelLeftOpen, PhoneCall, Search, Settings, Waypoints,
} from 'lucide-react';
import { api } from '../lib/api';
import { useMe } from '../lib/me';

type Item = { to: string; label: string; icon: typeof Activity };
const GROUPS: { title: string; items: Item[] }[] = [
  { title: 'Project', items: [
    { to: '/', label: 'Overview', icon: LayoutDashboard },
    { to: '/sessions', label: 'Sessions', icon: Activity },
    { to: '/rooms', label: 'Live rooms', icon: DoorOpen },
    { to: '/agents', label: 'Agents', icon: Bot },
    { to: '/agent-analytics', label: 'Agent analytics', icon: Activity },
    { to: '/usage', label: 'Usage', icon: BarChart3 },
  ] },
  { title: 'Telephony', items: [
    { to: '/telephony/calls', label: 'Calls', icon: PhoneCall },
    { to: '/telephony/dispatch', label: 'Dispatch rules', icon: GitBranch },
    { to: '/telephony/phone-numbers', label: 'Phone numbers', icon: Hash },
    { to: '/telephony/trunks', label: 'SIP trunks', icon: Cable },
  ] },
  { title: 'Media', items: [
    { to: '/egress', label: 'Egress', icon: CircleDot },
    { to: '/ingress', label: 'Ingress', icon: Download },
  ] },
  { title: 'Tools', items: [{ to: '/tokens', label: 'Token generator', icon: KeyRound }, { to: '/repo-traffic', label: 'Repo traffic', icon: GitFork }] },
];
const ALL: Item[] = [...GROUPS.flatMap((g) => g.items), { to: '/settings', label: 'Settings', icon: Settings }];

function Palette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const list = useMemo(() => ALL.filter((x) => x.label.toLowerCase().includes(q.toLowerCase())), [q]);
  const go = (to: string) => { onClose(); navigate(to); };
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="palette" role="dialog" aria-label="Command palette">
        <input autoFocus className="input" placeholder="Jump to…" value={q} aria-label="Jump to"
          onChange={(e) => { setQ(e.target.value); setI(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setI((i + 1) % Math.max(1, list.length)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setI((i - 1 + list.length) % Math.max(1, list.length)); }
            if (e.key === 'Enter' && list[i]) go(list[i].to);
            if (e.key === 'Escape') onClose();
          }} />
        <ul>
          {list.map((x, n) => (
            <li key={x.to} className={n === i ? 'on' : ''} onMouseEnter={() => setI(n)} onClick={() => go(x.to)}>
              <x.icon size={16} aria-hidden /> {x.label}
            </li>
          ))}
          {list.length === 0 && <li className="muted">No matches</li>}
        </ul>
      </div>
    </>
  );
}

export function AppShell() {
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('lkc.collapsed') === '1');
  const [palette, setPalette] = useState(false);
  const me = useMe();
  const mac = useRef(/Mac/i.test(navigator.platform));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const toggle = () => { localStorage.setItem('lkc.collapsed', collapsed ? '0' : '1'); setCollapsed(!collapsed); };
  const logout = async () => { await api('/auth/logout', { method: 'POST' }); navigate('/login'); };

  return (
    <div className={`shell ${collapsed ? 'collapsed' : ''}`}>
      <aside className="sidebar" aria-label="Main navigation">
        <div className="brand">
          <span className="brand-mark"><Waypoints size={15} aria-hidden /></span>
          <span className="brand-text">LiveKit Console</span>
        </div>
        <button className="nav-link" onClick={() => setPalette(true)} style={{ background: 'none', border: 0, font: 'inherit' }} title="Search">
          <Search size={16} aria-hidden /><span className="nav-label">Search <kbd>{mac.current ? '⌘' : 'Ctrl'} K</kbd></span>
        </button>
        {GROUPS.map((g) => (
          <div key={g.title}>
            <div className="nav-group">{g.title}</div>
            {g.items.map((it) => (
              <NavLink key={it.to} to={it.to} end={it.to === '/'} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} title={it.label}>
                <it.icon size={16} aria-hidden /><span className="nav-label">{it.label}</span>
              </NavLink>
            ))}
          </div>
        ))}
        <div className="sidebar-foot">
          {me.data && <div className="nav-label muted" style={{ padding: '4px 10px', fontSize: 12 }}>{me.data.user} · {me.data.role === 'viewer' ? 'Read-only' : 'Admin'}</div>}
          <NavLink to="/settings" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} title="Settings"><Settings size={16} aria-hidden /><span className="nav-label">Settings</span></NavLink>
          <button className="nav-link" onClick={logout} style={{ background: 'none', border: 0, font: 'inherit' }} title="Sign out"><LogOut size={16} aria-hidden /><span className="nav-label">Sign out</span></button>
          <button className="nav-link" onClick={toggle} style={{ background: 'none', border: 0, font: 'inherit' }} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {collapsed ? <PanelLeftOpen size={16} aria-hidden /> : <PanelLeftClose size={16} aria-hidden />}<span className="nav-label">Collapse</span>
          </button>
        </div>
      </aside>
      <main className="content"><div className="page"><Outlet /></div></main>
      {palette && <Palette onClose={() => setPalette(false)} />}
    </div>
  );
}
