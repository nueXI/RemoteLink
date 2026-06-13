import client from './client';
import { getToken } from './auth';

export interface RemoteFile {
  name: string;
  size: number;
  modified: string;
}

export async function listFiles(): Promise<RemoteFile[]> {
  const { data } = await client.get<RemoteFile[]>('/api/files');
  return data;
}

export async function uploadFiles(files: FileList): Promise<void> {
  const form = new FormData();
  for (const file of Array.from(files)) {
    form.append('files', file);
  }
  await client.post('/api/files/upload', form);
}

export function downloadUrl(fileName: string): string {
  const token = getToken();
  return `/api/files/download/${encodeURIComponent(fileName)}?token=${token}`;
}

export async function deleteFile(fileName: string): Promise<void> {
  await client.delete(`/api/files/${encodeURIComponent(fileName)}`);
}
