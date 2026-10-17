import { useQuery } from '@tanstack/react-query';
import { Navigate, Route, Routes } from 'react-router-dom';
import { api } from './lib/api';
import { AppShell } from './components/AppShell';
import { Agents } from './pages/Agents';
import { CallDetail, Calls } from './pages/Calls';
import { Dispatch } from './pages/Dispatch';
import { Egress } from './pages/Egress';
import { Ingress } from './pages/Ingress';
import { Login } from './pages/Login';
import { Overview } from './pages/Overview';
import { PhoneNumbers } from './pages/PhoneNumbers';
import { RoomDetail, Rooms } from './pages/Rooms';
import { ParticipantDetail, SessionDetail, Sessions } from './pages/Sessions';
import { Settings } from './pages/Settings';
import { Tokens } from './pages/Tokens';
import { Trunks } from './pages/Trunks';
import { Usage } from './pages/Usage';

function Protected() {
  const me = useQuery({ queryKey: ['me'], queryFn: () => api('/auth/me'), retry: false });
  if (me.isPending) return null;
  return me.isError ? <Navigate to="/login" replace /> : <AppShell />;
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
        <Route path="agents" element={<Agents />} />
        <Route path="usage" element={<Usage />} />
        <Route path="telephony/calls" element={<Calls />} />
        <Route path="telephony/calls/:id" element={<CallDetail />} />
        <Route path="telephony/dispatch" element={<Dispatch />} />
        <Route path="telephony/phone-numbers" element={<PhoneNumbers />} />
        <Route path="telephony/trunks" element={<Trunks />} />
        <Route path="egress" element={<Egress />} />
        <Route path="ingress" element={<Ingress />} />
        <Route path="tokens" element={<Tokens />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
