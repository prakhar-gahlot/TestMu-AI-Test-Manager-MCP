import axios, { type AxiosInstance, type AxiosRequestConfig } from "axios";
import { config } from "./config.js";

export interface LambdaTestClient {
  get<T = unknown>(url: string, requestConfig?: AxiosRequestConfig): Promise<T>;
  post<T = unknown>(url: string, data?: unknown, requestConfig?: AxiosRequestConfig): Promise<T>;
  put<T = unknown>(url: string, data?: unknown, requestConfig?: AxiosRequestConfig): Promise<T>;
  patch<T = unknown>(url: string, data?: unknown, requestConfig?: AxiosRequestConfig): Promise<T>;
  delete<T = unknown>(url: string, requestConfig?: AxiosRequestConfig): Promise<T>;
  // Separate from `post` because multipart bodies (native FormData) need the
  // instance's default `Content-Type: application/json` header overridden,
  // not merged with, for the request to be a valid multipart upload.
  postForm<T = unknown>(url: string, form: FormData): Promise<T>;
}

function createHttpInstance(): AxiosInstance {
  return axios.create({
    baseURL: config.testManager.baseUrl,
    auth: {
      username: config.testManager.username,
      password: config.testManager.accessKey,
    },
    headers: {
      "Content-Type": "application/json",
    },
  });
}

export function createLambdaTestClient(): LambdaTestClient {
  const http = createHttpInstance();

  return {
    async get(url, requestConfig) {
      const response = await http.get(url, requestConfig);
      return response.data;
    },
    async post(url, data, requestConfig) {
      const response = await http.post(url, data, requestConfig);
      return response.data;
    },
    async put(url, data, requestConfig) {
      const response = await http.put(url, data, requestConfig);
      return response.data;
    },
    async patch(url, data, requestConfig) {
      const response = await http.patch(url, data, requestConfig);
      return response.data;
    },
    async delete(url, requestConfig) {
      const response = await http.delete(url, requestConfig);
      return response.data;
    },
    async postForm(url, form) {
      const response = await http.post(url, form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      return response.data;
    },
  };
}
