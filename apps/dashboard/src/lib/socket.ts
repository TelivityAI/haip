import { io, type Socket } from 'socket.io-client';
import { AUTH_ENABLED, keycloak } from './keycloak';

let socket: Socket | null = null;

function socketAuthPayload(): Record<string, string> {
  if (AUTH_ENABLED && keycloak.token) {
    return { token: keycloak.token };
  }
  return {};
}

export function getSocket(): Socket {
  if (!socket) {
    socket = io('/', {
      transports: ['websocket', 'polling'],
      autoConnect: false,
      auth: socketAuthPayload(),
    });
  }
  return socket;
}

/** Reconnect with a fresh JWT after Keycloak token refresh. */
export function reconnectSocket() {
  const s = getSocket();
  s.auth = socketAuthPayload();
  if (s.connected) {
    s.disconnect();
    s.connect();
  }
}

export function joinPropertyRoom(propertyId: string) {
  const s = getSocket();
  if (!s.connected) s.connect();
  s.emit('joinProperty', { propertyId });
}

export function leavePropertyRoom(propertyId: string) {
  const s = getSocket();
  s.emit('leaveProperty', { propertyId });
}
