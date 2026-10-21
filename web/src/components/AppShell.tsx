import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity, BarChart3, GitFork, Bot, Cable, CircleDot, DoorOpen, Download, GitBranch, Hash, KeyRound,
  LayoutDashboard, LogOut, Menu, X, PanelLeftClose, PanelLeftOpen, PhoneCall, Search, Settings,
} from 'lucide-react';
import { Brand } from './Brand';
import { api } from '../lib/api';
import { useMe, can } from '../lib/me';

type Item = { to: string; label: string; icon: typeof Activity; admin?: boolean; transcripts?: boolean };
const GROUPS: { title: string; items: Item[] }[] = [
  { title: 'Console', items: [
    { to: '/', label: 'Overview', icon: LayoutDashboard },
    { to: '/sessions', label: 'Sessions', icon: Activity },
    { to: '/rooms', label: 'Live rooms', icon: DoorOpen },
    { to: '/agents', label: 'Agents', icon: Bot },
    { to: '/agent-analytics', label: 'Agent analytics', icon: Activity, transcripts: true },
    { to: '/usage', label: 'Usage', icon: BarChart3, transcripts: true },
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
  { title: 'Administration', items: [
    { to: '/deployments', label: 'Deployments', icon: GitBranch, admin: true },
    { to: '/agent-testing', label: 'Agent testing', icon: Bot, admin: true, transcripts: true },
    { to: '/operations', label: 'Operations', icon: Settings, admin: true },
    { to: '/diagnostics', label: 'Diagnostics', icon: Activity, admin: true },
    { to: '/telephony/diagnostics', label: 'SIP diagnostics', icon: Activity, admin: true },
  ] },
  { title: 'Tools', items: [{ to: '/tokens', label: 'Token generator', icon: KeyRound }, { to: '/repo-traffic', label: 'Repo traffic', icon: GitFork }] },
];
const ALL: Item[] = [...GROUPS.flatMap((g) => g.items), { to: '/settings', label: 'Settings', icon: Settings }];

function Palette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const opener=useRef<HTMLElement|null>(document.activeElement as HTMLElement);
  useEffect(()=>{return()=>{if(opener.current?.getClientRects().length)opener.current.focus();else document.querySelector<HTMLButtonElement>('[aria-label="Open navigation"]')?.focus();};},[]);
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const me = useMe();
  const list = useMemo(() => ALL.filter(x => (!x.admin || me.data?.role === 'admin') && (!x.transcripts || can(me.data, 'transcripts')) && x.label.toLowerCase().includes(q.toLowerCase())), [q, me.data]);
  const go = (to: string) => { onClose(); navigate(to); };
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={e=>{if(e.key==='Tab'){e.preventDefault();e.currentTarget.querySelector<HTMLInputElement>('input')?.focus();}}}>
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
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('lkc.collapsed') === '1'; } catch { return false; } });
  const [palette, setPalette] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [mobile, setMobile] = useState(() => matchMedia('(max-width:820px)').matches);
  const location = useLocation();
  const nav = useRef<HTMLElement>(null), navButton = useRef<HTMLButtonElement>(null);
  const closeNav = () => { setNavOpen(false); navButton.current?.focus(); };
  const openSearch = () => { setNavOpen(false); setPalette(true); };
  useEffect(() => { setNavOpen(false); }, [location.pathname, location.search]);
  useEffect(() => { const media = matchMedia('(max-width:820px)'); const changed = () => { setMobile(media.matches); if (!media.matches) setNavOpen(false); }; media.addEventListener('change', changed); return () => media.removeEventListener('change', changed); }, []);
  useEffect(() => {
    if (!navOpen) return;
    nav.current?.querySelector<HTMLButtonElement>('.mobile-nav-close')?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closeNav(); }
      if (e.key === 'Tab') { const items = Array.from(nav.current?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled)') ?? []).filter(el => el.getClientRects().length);
        if (e.shiftKey && document.activeElement === items[0]) { e.preventDefault(); items.at(-1)?.focus(); }
        else if (!e.shiftKey && document.activeElement === items.at(-1)) { e.preventDefault(); items[0]?.focus(); }
      }
    }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [navOpen]);
  const me = useMe();
  const mac = useRef(/Mac/i.test(navigator.platform));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setNavOpen(false); setPalette((p) => !p); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const toggle = () => { try { localStorage.setItem('lkc.collapsed', collapsed ? '0' : '1'); } catch { /* Session-only navigation still works. */ } setCollapsed(!collapsed); };
  const logout = async () => { await api('/auth/logout', { method: 'POST' }); window.location.assign('/login'); };

  return (
    <div className={`shell ${collapsed ? 'collapsed' : ''} ${navOpen ? 'nav-open' : ''}`}>
      <div className="mobile-topbar"><Brand /><button ref={navButton} className="btn secondary icon" aria-label="Open navigation" aria-expanded={navOpen} aria-controls="console-navigation" onClick={() => setNavOpen(true)}><Menu size={20} aria-hidden /></button></div>
      {navOpen && <button className="nav-backdrop" tabIndex={-1} aria-label="Close navigation" onClick={closeNav} />}
      <aside ref={nav} id="console-navigation" className="sidebar" aria-label={mobile ? 'Navigation' : 'Main navigation'} role={mobile&&navOpen?'dialog':undefined} aria-modal={mobile&&navOpen?true:undefined}>
        <button className="btn ghost icon mobile-nav-close" aria-label="Close navigation" onClick={closeNav}><X size={20} aria-hidden /></button>
        <Brand />
        <button className="nav-link" onClick={openSearch} aria-label="Search" style={{ background: 'none', border: 0, font: 'inherit' }} title="Search">
          <Search size={16} aria-hidden /><span className="nav-label">Search <kbd>{mac.current ? '⌘' : 'Ctrl'} K</kbd></span>
        </button>
        {GROUPS.filter(g=>g.items.some(it=>(!it.admin||me.data?.role==='admin')&&(!it.transcripts||can(me.data,'transcripts')))).map((g) => (
          <div key={g.title}>
            <div className="nav-group">{g.title}</div>
            {g.items.filter(it => (!it.admin || me.data?.role === 'admin') && (!it.transcripts || can(me.data, 'transcripts'))).map((it) => (
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
          <Brand footer />
        </div>
      </aside>
      <main className="content" {...(mobile&&navOpen?{inert:''}:{})}><div className="page"><Outlet /></div></main>
      {palette && <Palette onClose={() => setPalette(false)} />}
    </div>
  );
}
