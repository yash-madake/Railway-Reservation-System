/**
 * The API's base URL — origin only, no path prefix.
 *
 * Read once, here, and imported everywhere else so there is exactly one place
 * that decides where the backend lives. There is deliberately no dev proxy in
 * vite.config.js: a proxy exists only in `vite dev`, so a production build
 * would send relative requests to the static host and 404.
 *
 * Set VITE_API_URL per environment, e.g.
 *   local      http://localhost:5000
 *   deployed   https://api.yatrio.example.com
 */
export const API_BASE_URL =
  import.meta.env.VITE_API_URL || 'http://localhost:5000';
export class ApiError extends Error {
    status;
    code;
    field;
    constructor(status, message, code = 'REQUEST_FAILED', field = null) {
        super(message);
        this.status = status;
        this.code = code;
        this.field = field;
        this.name = 'ApiError';
    }
}
/**
 * Every backend endpoint answers with one envelope:
 *   failure  { error: { code, message, field } }
 *   success  the resource at the top level
 *
 * `code` is what the UI branches on (SIGNATURE_MISMATCH, ORDER_EXPIRED,
 * ALREADY_PAID ...), so it is carried on the error rather than flattened away.
 */
async function handleResponse(response) {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const err = payload?.error ?? {};
        throw new ApiError(
            response.status,
            err.message || payload?.message || response.statusText || 'Request failed',
            err.code || 'REQUEST_FAILED',
            err.field ?? null,
        );
    }
    // Tolerate a { data } envelope for any endpoint that adopts one later.
    return payload?.data !== undefined ? payload.data : payload;
}
function getHeaders() {
    const headers = {
        'Content-Type': 'application/json',
    };
    // AuthContext writes railsetu_token; auth_token is kept as a fallback for
    // sessions created before the key was renamed.
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
