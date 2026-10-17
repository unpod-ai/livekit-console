import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export type Me = { user: string; role: 'admin' | 'viewer'; source: 'env' | 'db' };
export const useMe = () => useQuery<Me>({ queryKey: ['me'], queryFn: () => api<Me>('/auth/me'), retry: false });
