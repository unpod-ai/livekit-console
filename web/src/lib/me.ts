import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { isLegacyDefault, type Capabilities } from './project';
export type Me = { user: string; role: 'admin' | 'viewer'; source: 'env' | 'db'; globalAdmin?: boolean; capabilities?: Capabilities; projectId?: string };
export const can = (me: Me | undefined, capability: keyof Capabilities) => me?.capabilities?.[capability] === true || (isLegacyDefault() && !me?.capabilities && me?.role === 'admin');
export const isGlobalAdmin = (me?: Me) => me?.globalAdmin === true || (isLegacyDefault() && me?.globalAdmin === undefined && me?.role === 'admin');
export const useMe = () => useQuery<Me>({ queryKey: ['me'], queryFn: () => api<Me>('/auth/me'), retry: false });
