import { Navigate, Route, Routes } from './lib/router';
import { ApiError } from './lib/api';
import { useMe, can } from './lib/me';
import { ProjectSelector, SignOut } from './lib/projects';
import { Alert } from './components/ui';
import { Operations } from './pages/Operations';
import { AppShell } from './components/AppShell';
import { AgentDetail } from './pages/AgentDetail';
import { Agents } from './pages/Agents';
import { CallDetail, Calls } from './pages/Calls';
import { Diagnostics, TelephonyDiagnostics } from './pages/Diagnostics';
import { Dispatch } from './pages/Dispatch';
import { Egress, EgressDetail } from './pages/Egress';
import { Ingress } from './pages/Ingress';
import { Login } from './pages/Login';
import { Performance } from './pages/Performance';
import { Overview } from './pages/Overview';
import { PhoneNumbers } from './pages/PhoneNumbers';
import { RoomDetail, Rooms } from './pages/Rooms';
import { ParticipantDetail, SessionDetail, Sessions } from './pages/Sessions';
import { RepoTraffic } from './pages/RepoTraffic';
import { Settings } from './pages/Settings';
import { Tokens } from './pages/Tokens';
import { Trunks } from './pages/Trunks';
import { Usage } from './pages/Usage';

function Protected() {
  const me = useMe();
  if (me.isPending) return null;
  if (me.error instanceof ApiError && me.error.status === 401) return <Navigate to="/login" replace />;
  if (me.isError) return <div className="page"><Alert kind="bad">{me.error instanceof ApiError && me.error.status === 403 ? 'You no longer have access to this project.' : 'This project is temporarily unavailable.'}</Alert><button className="btn secondary" onClick={() => me.refetch()}>Retry</button><ProjectSelector /><SignOut /></div>;
  return <AppShell />;
}

function ContentAccess({ children }: { children: React.ReactNode }) {
  const me = useMe();
  return can(me.data, 'transcripts') ? <>{children}</> : <Alert>Transcript access is required to view usage.</Alert>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Protected />}>
        <Route index element={<Overview />} />
        <Route path="sessions" element={<Sessions />} />
        <Route path="sessions/:sid" element={<SessionDetail />} />
        <Route path="sessions/:sid/participants/:psid" element={<ParticipantDetail />} />
        <Route path="rooms" element={<Rooms />} />
        <Route path="rooms/:name" element={<RoomDetail />} />
        <Route path="agent-analytics" element={<Performance />} />
        <Route path="agents" element={<Agents />} />
        <Route path="agents/:name" element={<AgentDetail />} />
        <Route path="diagnostics" element={<Diagnostics />} />
        <Route path="telephony/diagnostics" element={<TelephonyDiagnostics />} />
        <Route path="usage" element={<ContentAccess><Usage /></ContentAccess>} />
        <Route path="operations" element={<Operations />} />
        <Route path="telephony/calls" element={<Calls />} />
        <Route path="telephony/calls/:id" element={<CallDetail />} />
        <Route path="telephony/dispatch" element={<Dispatch />} />
        <Route path="telephony/phone-numbers" element={<PhoneNumbers />} />
        <Route path="telephony/trunks" element={<Trunks />} />
        <Route path="egress" element={<Egress />} />
        <Route path="egress/:id" element={<EgressDetail />} />
        <Route path="ingress" element={<Ingress />} />
        <Route path="tokens" element={<Tokens />} />
        <Route path="repo-traffic" element={<RepoTraffic />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
