import { useQuery } from '@tanstack/react-query';
import { api } from './api';
export type Capabilities = { transcripts: boolean; recordings: boolean; logs: boolean };
export type Me = { user: string; role: 'admin' | 'viewer'; source: 'env' | 'db'; capabilities: Capabilities };
export const can = (me: Me | undefined, capability: keyof Capabilities) => me?.capabilities?.[capability] === true;
export const useMe = () => useQuery<Me>({ queryKey: ['me'], queryFn: () => api<Me>('/auth/me'), retry: false });
