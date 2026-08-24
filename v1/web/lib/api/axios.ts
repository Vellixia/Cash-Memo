import axios, { type AxiosError, type AxiosRequestConfig, type AxiosResponse } from "axios";

export type ApiError = {
  code: string;
  message: string;
  fields?: Record<string, string[]>;
  request_id: string;
};

export const api = axios.create({
  baseURL: "/api/v1",
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
});

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ error?: ApiError }>) => {
    const canonical = error.response?.data?.error;
    if (canonical && error.response) {
      error.message = canonical.message;
      error.response.data = { error: canonical };
    }
    return Promise.reject(error);
  },
);

export const customAxios = <T>(config: AxiosRequestConfig): Promise<AxiosResponse<T>> =>
  api.request<T>(config);
