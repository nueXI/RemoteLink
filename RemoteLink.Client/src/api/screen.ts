import * as signalR from '@microsoft/signalr';
import { getToken } from './auth';
import client from './client';

export interface Monitor {
  index: number;
  width: number;
  height: number;
  primary: boolean;
  name: string;
}

export interface MonitorsResult {
  monitors: Monitor[];
  currentIndex: number;
  h264Available: boolean;
}

export function createScreenConnection() {
  return new signalR.HubConnectionBuilder()
    .withUrl('/hubs/screen', {
      accessTokenFactory: () => getToken() ?? '',
    })
    .withAutomaticReconnect()
    .build();
}

export async function getMonitors(): Promise<MonitorsResult> {
  const res = await client.get<MonitorsResult>('/api/screen/monitors');
  return res.data;
}
