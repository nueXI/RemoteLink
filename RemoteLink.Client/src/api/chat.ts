import * as signalR from '@microsoft/signalr';
import { getToken } from './auth';
import client from './client';

export interface ChatMessage {
  sender: string;
  message: string;
  timestamp: string;
}

export function createChatConnection(): signalR.HubConnection {
  return new signalR.HubConnectionBuilder()
    .withUrl('/hubs/chat', {
      accessTokenFactory: () => getToken() ?? '',
    })
    .withAutomaticReconnect()
    .build();
}

export async function getChatLogDates(): Promise<string[]> {
  const res = await client.get<string[]>('/api/chat/logs');
  return res.data;
}

export async function getChatLog(date: string): Promise<ChatMessage[]> {
  const res = await client.get<ChatMessage[]>(`/api/chat/logs/${date}`);
  return res.data;
}

export async function deleteChatLog(date: string): Promise<void> {
  await client.delete(`/api/chat/logs/${date}`);
}
