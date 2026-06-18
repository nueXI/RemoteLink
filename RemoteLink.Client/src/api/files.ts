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

export async function uploadFiles(
  files: FileList,
  onProgress?: (percent: number) => void,
): Promise<void> {
  const form = new FormData();
  for (const file of Array.from(files)) form.append('files', file);

  const token = getToken();

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/files/upload');
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress)
        onProgress(Math.round((e.loaded / e.total) * 100));
    };

    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`${xhr.status}`));
    xhr.onerror  = () => reject(new Error('Network error'));
    xhr.onabort  = () => reject(new Error('Aborted'));

    xhr.send(form);
  });
}

export function downloadUrl(fileName: string): string {
  const token = getToken();
  return `/api/files/download/${encodeURIComponent(fileName)}?token=${token}`;
}

export async function deleteFile(fileName: string): Promise<void> {
  await client.delete(`/api/files/${encodeURIComponent(fileName)}`);
}
