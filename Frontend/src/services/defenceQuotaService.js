import { apiClient } from '@/api/client';

export const defenceQuotaService = {
  async getVerifiedCandidates() {
    return apiClient.get('/admin/defence-candidates');
  },
};
