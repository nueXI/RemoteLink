import axios from 'axios';

const TOKEN_KEY = 'rl_token';

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}

export async function login(password: string): Promise<boolean> {
  try {
    const { data } = await axios.post('/api/auth/login', { password });
    setToken(data.token);
    return true;
  } catch {
    return false;
  }
}
