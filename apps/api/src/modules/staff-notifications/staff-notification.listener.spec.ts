import { StaffNotificationListener } from './staff-notification.listener';
import type { WebhookDeliveryFailedEvent } from '../webhook/webhook-delivery.service';

describe('StaffNotificationListener — webhook.delivery_failed', () => {
  const basePayload: WebhookDeliveryFailedEvent = {
    propertyId: 'prop-1',
    subscriptionId: 'sub-1',
    subscriberName: 'BR Compliance Service',
    deliveryId: 'del-1',
    eventType: 'reservation.checked_in',
    attempts: 5,
    lastError: 'HTTP 500',
  };

  let staffNotifications: { create: ReturnType<typeof vi.fn> };
  let listener: StaffNotificationListener;

  beforeEach(() => {
    staffNotifications = { create: vi.fn().mockResolvedValue({}) };
    listener = new StaffNotificationListener(staffNotifications as any);
  });

  it('creates a critical notification when a delivery permanently fails', async () => {
    await listener.onWebhookDeliveryFailed(basePayload);

    expect(staffNotifications.create).toHaveBeenCalledTimes(1);
    expect(staffNotifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        propertyId: 'prop-1',
        type: 'webhook_delivery_failed',
        severity: 'critical',
        sourceEvent: 'webhook.delivery_failed',
        sourceEntityType: 'webhook_delivery',
        sourceEntityId: 'del-1',
      }),
    );
    const arg = staffNotifications.create.mock.calls[0]![0];
    expect(arg.title).toContain('reservation.checked_in');
    expect(arg.message).toContain('BR Compliance Service');
    expect(arg.message).toContain('5 attempts');
  });

  it('falls back to the subscription id when subscriberName is missing', async () => {
    await listener.onWebhookDeliveryFailed({ ...basePayload, subscriberName: null });
    const arg = staffNotifications.create.mock.calls[0]![0];
    expect(arg.message).toContain('sub-1');
  });

  it('skips staff.notification_created failures (loop guard)', async () => {
    await listener.onWebhookDeliveryFailed({
      ...basePayload,
      eventType: 'staff.notification_created',
    });
    expect(staffNotifications.create).not.toHaveBeenCalled();
  });

  it('ignores payloads without a propertyId', async () => {
    await listener.onWebhookDeliveryFailed({ ...basePayload, propertyId: '' });
    expect(staffNotifications.create).not.toHaveBeenCalled();
  });
});
