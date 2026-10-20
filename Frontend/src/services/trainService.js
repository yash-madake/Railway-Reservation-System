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
};

