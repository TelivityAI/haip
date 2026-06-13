/**
 * Builds the ChatGPT-importable OpenAPI 3.1 spec for the Telivity HAIP GPT.
 *
 * Hand-authored (not derived from NestJS Swagger) so the public AI surface stays
 * small, hotel-shaped, and decoupled from HAIP's internal endpoints. Request
 * schemas mirror HAIP's Connect DTOs exactly — no invented hotel fields. Response
 * schemas describe selling-price fields only.
 */

export function buildOpenApiSpec(publicBaseUrl: string): Record<string, unknown> {
  const server = publicBaseUrl.replace(/\/+$/, '');

  const cancellationPolicy = {
    type: 'object',
    description: 'Cancellation terms attached to this rate / booking.',
    properties: {
      type: { type: 'string', enum: ['free', 'non_refundable', 'tiered'] },
      freeCancellationBefore: {
        type: 'string',
        format: 'date-time',
        description: 'Cancel free of charge before this instant (ISO 8601).',
      },
      penaltyType: { type: 'string', enum: ['percentage', 'flat', 'first_night'] },
      penaltyAmount: { type: 'number' },
      description: { type: 'string' },
    },
  };

  const nightly = {
    type: 'array',
    description: 'Per-night selling-price breakdown.',
    items: {
      type: 'object',
      properties: {
        date: { type: 'string', format: 'date' },
        baseRate: { type: 'number', description: 'Per-night selling price.' },
        taxAmount: { type: 'number' },
        totalRate: { type: 'number' },
      },
    },
  };

  const rate = {
    type: 'object',
    properties: {
      ratePlanId: { type: 'string', format: 'uuid' },
      ratePlanName: { type: 'string' },
      ratePlanCode: { type: 'string' },
      rateType: {
        type: 'string',
        description: 'e.g. bar, derived, negotiated, package, promotional.',
      },
      totalAmount: { type: 'number', description: 'Total selling price for the stay.' },
      currencyCode: { type: 'string', example: 'USD' },
      nightlyBreakdown: nightly,
      cancellationPolicy,
      minLos: { type: 'integer' },
      maxLos: { type: 'integer' },
    },
  };

  const roomType = {
    type: 'object',
    properties: {
      roomTypeId: { type: 'string', format: 'uuid' },
      roomTypeName: { type: 'string' },
      description: { type: 'string' },
      maxOccupancy: { type: 'integer' },
      bedType: { type: 'string' },
      isAccessible: { type: 'boolean' },
      amenities: { type: 'array', items: { type: 'string' } },
      available: { type: 'integer', description: 'Rooms available across the date range.' },
      rates: { type: 'array', items: rate },
    },
  };

  return {
    openapi: '3.1.0',
    info: {
      title: 'Telivity HAIP — Hotel Booking',
      description:
        'Search hotels, price rooms, and create, look up, modify, or cancel reservations through the HAIP (Hotel AI Platform) Connect API. All prices are guest-facing selling prices.',
      version: '1.0.0',
      contact: { name: 'Telivity', url: server },
    },
    servers: [{ url: server }],
    paths: {
      '/hotels/search': {
        post: {
          operationId: 'searchHotels',
          summary: 'Search hotels with availability and rates',
          description:
            'Find available properties for a stay. Provide a location (city, or latitude/longitude, or a specific propertyId) plus check-in/check-out dates and occupancy. Returns properties with room types, rate plans, nightly breakdown, and cancellation policy.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['checkIn', 'checkOut'],
                  properties: {
                    city: { type: 'string', description: 'City name, e.g. "New York".' },
                    latitude: { type: 'number' },
                    longitude: { type: 'number' },
                    radiusKm: { type: 'number', description: 'Search radius around lat/long, in km.' },
                    propertyId: {
                      type: 'string',
                      format: 'uuid',
                      description: 'Restrict the search to a single known property.',
                    },
                    checkIn: { type: 'string', format: 'date', description: 'Arrival date (YYYY-MM-DD).' },
                    checkOut: { type: 'string', format: 'date', description: 'Departure date (YYYY-MM-DD).' },
                    rooms: { type: 'integer', minimum: 1, default: 1 },
                    adults: { type: 'integer', minimum: 1, default: 2 },
                    children: { type: 'integer', minimum: 0, default: 0 },
                    rateType: { type: 'string', description: 'Filter by rate type, e.g. "bar".' },
                    amenities: { type: 'array', items: { type: 'string' } },
                    accessibleOnly: { type: 'boolean' },
                    limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
                    offset: { type: 'integer', minimum: 0, default: 0 },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Search results.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      searchId: { type: 'string' },
                      totalResults: { type: 'integer' },
                      results: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            sourcePropertyId: { type: 'string', format: 'uuid' },
                            propertyName: { type: 'string' },
                            propertyCode: { type: 'string' },
                            starRating: { type: 'number' },
                            address: { type: 'object', additionalProperties: true },
                            roomTypes: { type: 'array', items: roomType },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/hotels/{propertyId}': {
        get: {
          operationId: 'getProperty',
          summary: 'Get detailed property content',
          parameters: [
            {
              name: 'propertyId',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
          ],
          responses: {
            '200': {
              description: 'Property detail.',
              content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
            },
          },
        },
      },
      '/reservations': {
        post: {
          operationId: 'createReservation',
          summary: 'Create (book) a reservation',
          description:
            'Book a specific room type and rate plan returned by searchHotels. Returns a confirmationNumber used to look up, modify, or cancel the booking. Always confirm the cancellation policy and total selling price with the guest before booking.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: [
                    'propertyId',
                    'roomTypeId',
                    'ratePlanId',
                    'checkIn',
                    'checkOut',
                    'guestFirstName',
                    'guestLastName',
                    'adults',
                  ],
                  properties: {
                    propertyId: { type: 'string', format: 'uuid' },
                    roomTypeId: { type: 'string', format: 'uuid' },
                    ratePlanId: { type: 'string', format: 'uuid' },
                    checkIn: { type: 'string', format: 'date' },
                    checkOut: { type: 'string', format: 'date' },
                    guestFirstName: { type: 'string' },
                    guestLastName: { type: 'string' },
                    guestEmail: { type: 'string', format: 'email' },
                    guestPhone: { type: 'string' },
                    loyaltyNumber: { type: 'string' },
                    adults: { type: 'integer', minimum: 1 },
                    children: { type: 'integer', minimum: 0, default: 0 },
                    specialRequests: { type: 'string' },
                    paymentMethod: {
                      type: 'string',
                      enum: ['pay_at_property', 'prepaid', 'virtual_card'],
                    },
                  },
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Booking confirmed.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' },
                      confirmationNumber: { type: 'string' },
                      status: { type: 'string' },
                      totalAmount: { type: 'number' },
                      currencyCode: { type: 'string' },
                      cancellationPolicy,
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/reservations/{confirmationNumber}': {
        get: {
          operationId: 'getReservation',
          summary: 'Look up a reservation by confirmation number',
          parameters: [confirmationParam()],
          responses: {
            '200': {
              description: 'Reservation status and details.',
              content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
            },
          },
        },
        patch: {
          operationId: 'modifyReservation',
          summary: 'Modify a reservation',
          description:
            'Change guest details, occupancy, dates, room type, or rate plan. Send only the fields being changed. Date / room / rate changes re-price the stay; the response includes the cost difference in selling price.',
          parameters: [confirmationParam()],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    guestFirstName: { type: 'string' },
                    guestLastName: { type: 'string' },
                    specialRequests: { type: 'string' },
                    adults: { type: 'integer', minimum: 1 },
                    children: { type: 'integer', minimum: 0 },
                    checkIn: { type: 'string', format: 'date' },
                    checkOut: { type: 'string', format: 'date' },
                    roomTypeId: { type: 'string', format: 'uuid' },
                    ratePlanId: { type: 'string', format: 'uuid' },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Modification result.',
              content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
            },
          },
        },
        delete: {
          operationId: 'cancelReservation',
          summary: 'Cancel a reservation',
          description:
            'Cancel a booking. The response includes any cancellation penalty and refund amount (selling price). Confirm the penalty with the guest before cancelling.',
          parameters: [confirmationParam()],
          requestBody: {
            required: false,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { reason: { type: 'string' } },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Cancellation result.',
              content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
            },
          },
        },
      },
    },
  };
}

function confirmationParam(): Record<string, unknown> {
  return {
    name: 'confirmationNumber',
    in: 'path',
    required: true,
    description: 'The confirmation number returned by createReservation.',
    schema: { type: 'string' },
  };
}
