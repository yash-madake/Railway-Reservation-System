import { apiClient } from '@/api/client';

/** Read-only train timetable operations used by the Train Status page. */
export const trainService = {
  search: async (query) => apiClient.get('/trains/search', {
    q: query,
    limit: 20,
  }),

  getDetails: async (trainNumber) =>
    apiClient.get(`/trains/${encodeURIComponent(trainNumber ?? '')}`),

  getStatus: async (trainNumber) =>
    apiClient.get(`/trains/status/${encodeURIComponent(trainNumber ?? '')}`),

  getSchedule: async (trainNumber) =>
    apiClient.get(`/trains/${encodeURIComponent(trainNumber ?? '')}/schedule`),

  getAvailability: async (trainNumber, { date, classCode, quota = 'GN' } = {}) => {
    const query = new URLSearchParams();
    if (date) query.set('date', date);
    if (classCode) query.set('class', classCode);
    if (quota) query.set('quota', quota);
    return apiClient.get(`/trains/${encodeURIComponent(trainNumber ?? '')}/availability?${query.toString()}`);
  },

  getFare: async (trainNumber, { from, to, classCode } = {}) => {
    const query = new URLSearchParams();
    if (from) query.set('from', from);
    if (to) query.set('to', to);
    if (classCode) query.set('class', classCode);
    return apiClient.get(`/trains/${encodeURIComponent(trainNumber ?? '')}/fare?${query.toString()}`);
  },

  getQuotas: async () => apiClient.get('/trains/quotas'),
};

