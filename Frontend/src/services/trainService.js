import { apiClient } from '@/api/client';

/**
 * Train operations.
 *
 * The timetable reads (`search` … `getQuotas`) come from main and back the
 * Train Status / search pages; the admin methods (`listAdmin` …
 * `getTrainById`) come from the admin project and back the Team 7 console.
 * Both sets are kept — different callers on each side of the merge.
 */
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

  // --- Admin console (Team 7) ---
  async listAdmin(params = {}) {
    return apiClient.get('/admin/trains', params);
  },
  async createAdmin(payload) {
    return apiClient.post('/admin/trains', payload);
  },
  async deactivateAdmin(id) {
    return apiClient.patch(`/admin/trains/${id}/deactivate`);
  },
  async deleteAdmin(id) {
    return apiClient.delete(`/admin/trains/${id}`);
  },
  async getAdmin(id) {
    return apiClient.get(`/admin/trains/${id}`);
  },
  async addRouteStop(id, payload) {
    return apiClient.post(`/admin/trains/${id}/routes`, payload);
  },
  async deleteRouteStop(trainId, routeId) {
    return apiClient.delete(`/admin/trains/${trainId}/routes/${routeId}`);
  },
  async searchTrains(params) {
    return apiClient.get('/trains/search', params);
  },
  async getAllTrains() {
    return apiClient.get('/trains/search', { page: 1, limit: 100 });
  },
  async getTrainById(id) {
    return apiClient.get(`/trains/${id}`);
  },
};

