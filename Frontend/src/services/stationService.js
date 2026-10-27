import { apiClient } from '@/api/client';

export const stationService = {
  async listAdmin(params = {}) {
    return apiClient.get('/admin/stations', params);
  },
  async createAdmin(payload) {
    return apiClient.post('/admin/stations', payload);
  },
  async updateAdmin(id, payload) {
    return apiClient.put(`/admin/stations/${id}`, payload);
  },
  async deactivateAdmin(id) {
    return apiClient.patch(`/admin/stations/${id}/deactivate`);
  },
  async getAllStations(params = {}) {
    const result = await apiClient.get('/stations', { page: 1, limit: 100, ...params });
    return result;
  }
};
