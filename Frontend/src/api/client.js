export const API_BASE_URL = import.meta.env.VITE_API_URL || '/api/v1';
export class ApiError extends Error {
    status;
    message;
    constructor(status, message) {
        super(message);
        this.status = status;
        this.message = message;
        this.name = 'ApiError';
    }
}
async function handleResponse(response) {
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new ApiError(response.status, errorData?.error?.message || errorData?.message || response.statusText);
    }
    const data = await response.json();
    return data.data;
}
function getHeaders() {
    const headers = {
        'Content-Type': 'application/json',
    };
    const token = localStorage.getItem('railsetu_token') || localStorage.getItem('auth_token');
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
}
export const apiClient = {
    async get(url, params) {
        const queryString = params ? `?${new URLSearchParams(params)}` : '';
        const response = await fetch(`${API_BASE_URL}${url}${queryString}`, {
            headers: getHeaders(),
        });
        return handleResponse(response);
    },
    async post(url, data) {
        const response = await fetch(`${API_BASE_URL}${url}`, {
            method: 'POST',
            headers: getHeaders(),
            body: data ? JSON.stringify(data) : undefined,
        });
        return handleResponse(response);
    },
    async put(url, data) {
        const response = await fetch(`${API_BASE_URL}${url}`, {
            method: 'PUT',
            headers: getHeaders(),
            body: JSON.stringify(data),
        });
        return handleResponse(response);
    },
    async patch(url, data) {
        const response = await fetch(`${API_BASE_URL}${url}`, {
            method: 'PATCH',
            headers: getHeaders(),
            body: JSON.stringify(data),
        });
        return handleResponse(response);
    },
    async delete(url) {
        const response = await fetch(`${API_BASE_URL}${url}`, {
            method: 'DELETE',
            headers: getHeaders(),
        });
        return handleResponse(response);
    },
};
