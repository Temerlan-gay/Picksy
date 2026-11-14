import { apiRequest } from '../../../shared/api/client.js';

export const getCurrentUser = () => apiRequest('/api/auth/me');
export const register = data => apiRequest('/api/auth/register', { method: 'POST', body: data });
export const login = data => apiRequest('/api/auth/login', { method: 'POST', body: data });
export const logout = () => apiRequest('/api/auth/logout', { method: 'POST' });
