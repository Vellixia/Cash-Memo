import axios, { type AxiosError, type AxiosRequestConfig, type AxiosResponse } from "axios";

export interface ApiError {
  code: string;
  message: string;
  fields?: Record<string, string[]>;
  request_id: string;
};

export const api = axios.create({
  baseURL: "/api/v1",
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    Pragma: "no-cache",
  },
});

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ error?: ApiError }>) => {
    const response = error.response;
    if (!response) return Promise.reject(error);
    const canonical = response.data.error;
    if (canonical) {
      error.message = canonical.message;
      response.data = { error: canonical };
    }
    return Promise.reject(error);
  },
);

export const customAxios = <T>(config: AxiosRequestConfig): Promise<AxiosResponse<T>> =>
  api.request<T>(config);
