/**
 * Minimal Streamable-HTTP-friendly MCP JSON-RPC surface for Claude / Gemini.
 * Supports initialize, tools/list, tools/call.
 */

import type { BookInput, ModifyInput, SearchInput } from './haip-connect-adapter.js';

export interface McpToolHandlers {
  searchHotels: (input: SearchInput) => Promise<unknown>;
  getProperty: (propertyId: string) => Promise<unknown>;
  prepareBooking: (input: BookInput, idempotencyKey?: string) => Promise<unknown>;
  confirmPayment: (confirmationNumber: string) => Promise<unknown>;
  getReservation: (confirmationNumber: string) => Promise<unknown>;
  modifyReservation: (confirmationNumber: string, body: ModifyInput) => Promise<unknown>;
  cancelReservation: (confirmationNumber: string, reason?: string) => Promise<unknown>;
}

const TOOL_DEFS = [
  {
    name: 'searchHotels',
    description: 'Search Ligare-enabled hotels with live availability and tax-inclusive rates.',
    inputSchema: {
      type: 'object',
      required: ['checkIn', 'checkOut'],
      properties: {
        city: { type: 'string' },
        propertyId: { type: 'string' },
        checkIn: { type: 'string' },
        checkOut: { type: 'string' },
        adults: { type: 'number' },
        children: { type: 'number' },
      },
    },
  },
  {
    name: 'getProperty',
    description: 'Get property detail (404 if not opted into Ligare).',
    inputSchema: {
      type: 'object',
      required: ['propertyId'],
      properties: { propertyId: { type: 'string' } },
    },
  },
  {
    name: 'prepareBooking',
    description:
      'Create a pending booking and return paymentUrl + paymentMode. Requires guestEmail and idempotencyKey. Never send card data.',
    inputSchema: {
      type: 'object',
      required: [
        'propertyId',
        'roomTypeId',
        'ratePlanId',
        'checkIn',
        'checkOut',
        'guestFirstName',
        'guestLastName',
        'guestEmail',
        'adults',
        'idempotencyKey',
      ],
      properties: {
        propertyId: { type: 'string' },
        roomTypeId: { type: 'string' },
        ratePlanId: { type: 'string' },
        checkIn: { type: 'string' },
        checkOut: { type: 'string' },
        guestFirstName: { type: 'string' },
        guestLastName: { type: 'string' },
        guestEmail: { type: 'string' },
        adults: { type: 'number' },
        children: { type: 'number' },
        idempotencyKey: { type: 'string' },
        clientPlatform: { type: 'string', enum: ['chatgpt', 'claude', 'gemini', 'ligare'] },
        specialRequests: { type: 'string' },
      },
    },
  },
  {
    name: 'confirmPayment',
    description:
      'Reconcile payment with the hotel PSP and confirm the reservation. Call after the guest pays via paymentUrl. Idempotent.',
    inputSchema: {
      type: 'object',
      required: ['confirmationNumber'],
      properties: { confirmationNumber: { type: 'string' } },
    },
  },
  {
    name: 'getReservation',
    description: 'Look up a reservation by confirmation number.',
    inputSchema: {
      type: 'object',
      required: ['confirmationNumber'],
      properties: { confirmationNumber: { type: 'string' } },
    },
  },
  {
    name: 'modifyReservation',
    description: 'Modify an existing reservation (send only changed fields).',
    inputSchema: {
      type: 'object',
      required: ['confirmationNumber'],
      properties: {
        confirmationNumber: { type: 'string' },
        guestFirstName: { type: 'string' },
        guestLastName: { type: 'string' },
        specialRequests: { type: 'string' },
        adults: { type: 'number' },
        children: { type: 'number' },
        checkIn: { type: 'string' },
        checkOut: { type: 'string' },
        roomTypeId: { type: 'string' },
        ratePlanId: { type: 'string' },
      },
    },
  },
  {
    name: 'cancelReservation',
    description: 'Cancel a reservation. Confirm any penalty with the guest first.',
    inputSchema: {
      type: 'object',
      required: ['confirmationNumber'],
      properties: {
        confirmationNumber: { type: 'string' },
        reason: { type: 'string' },
      },
    },
  },
] as const;

export function listMcpTools() {
  return TOOL_DEFS;
}

export async function handleMcpRequest(
  body: unknown,
  handlers: McpToolHandlers,
): Promise<unknown> {
  const msg = body as {
    jsonrpc?: string;
    id?: string | number | null;
    method?: string;
    params?: Record<string, unknown>;
  };

  const id = msg?.id ?? null;

  if (msg?.method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'ligare-hotels', version: '1.0.0' },
      },
    };
  }

  if (msg?.method === 'tools/list' || msg?.method === 'list_tools') {
    return {
      jsonrpc: '2.0',
      id,
      result: { tools: TOOL_DEFS },
    };
  }

  if (msg?.method === 'tools/call' || msg?.method === 'call_tool') {
    const name = String(msg.params?.['name'] ?? '');
    const args = (msg.params?.['arguments'] ?? {}) as Record<string, unknown>;
    try {
      const result = await dispatchTool(name, args, handlers);
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          structuredContent: result,
        },
      };
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32000,
          message: (err as Error).message,
        },
      };
    }
  }

  if (msg?.method === 'notifications/initialized' || msg?.method === 'ping') {
    return { jsonrpc: '2.0', id, result: {} };
  }

  return {
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Method not found: ${msg?.method}` },
  };
}

async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
  handlers: McpToolHandlers,
): Promise<unknown> {
  switch (name) {
    case 'searchHotels':
      return handlers.searchHotels(args as unknown as SearchInput);
    case 'getProperty':
      return handlers.getProperty(String(args['propertyId']));
    case 'prepareBooking': {
      const { idempotencyKey, ...rest } = args;
      return handlers.prepareBooking(
        rest as unknown as BookInput,
        idempotencyKey ? String(idempotencyKey) : undefined,
      );
    }
    case 'confirmPayment':
      return handlers.confirmPayment(String(args['confirmationNumber']));
    case 'getReservation':
      return handlers.getReservation(String(args['confirmationNumber']));
    case 'modifyReservation': {
      const { confirmationNumber, ...changes } = args;
      return handlers.modifyReservation(
        String(confirmationNumber),
        changes as unknown as ModifyInput,
      );
    }
    case 'cancelReservation':
      return handlers.cancelReservation(
        String(args['confirmationNumber']),
        args['reason'] ? String(args['reason']) : undefined,
      );
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
