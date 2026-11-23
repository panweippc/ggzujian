import axios from 'axios';

export const api = axios.create({ baseURL: '/api' });

export const login = (payload: any) => api.post('/login', payload).then(r => r.data);

export const getCaptcha = async () => {
  const r = await api.get('/captcha'); // { success, data: { token, svg } }
  return { token: r.data.data.token, svg: r.data.data.svg };
};

export const getUsers = (p: { page: number; pageSize: number }) =>
  api.get('/users', { params: p }).then(r => ({
    data: r.data.data || [], total: (r.data.data || []).length
  }));

export const getLogs = (p: any) =>
  api.get('/logs', { params: p }).then(r => ({
    data: r.data.data || [], total: r.data.total || 0
  }));
