import { apiClient } from '@/api/client';

export const trainService = {
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
  }
};
