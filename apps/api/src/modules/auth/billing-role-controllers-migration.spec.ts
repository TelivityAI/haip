import { describe, it, expect } from 'vitest';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';
import { PERMISSIONS_KEY } from './permissions.decorator';
import { ROLE_DEFAULT_PERMISSIONS } from './permissions.catalog';
import { PaymentController } from '../payment/payment.controller';
import { FolioController } from '../folio/folio.controller';
import { NotificationsController } from '../notifications/notifications.controller';
import { HouseAccountController } from '../house-account/house-account.controller';
import { CashierController } from '../cashier/cashier.controller';
import { AccountingController } from '../accounting/accounting.controller';

/**
 * Continues #340 / #361 (Charles @ modernitconsultants): billing controllers
 * off legacy @Roles() onto @RequirePermissions().
 *
 * Folio / cashier / house-account / accounting / notifications used to share
 * one realm-role list. PaymentController did not (admin/GM/front_desk/
 * reservations only). Refunds / voids / corrections / deposit refunds use
 * payments.refund so night_auditor can post overnight without refunding.
 *
 * Side effect retained from #361: communications.manage on notifications also
 * lets revenue_manager send guest SMS (already held that key via groups).
 */
const reflector = new Reflector();

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
function rolesOf(target: Function) {
  return reflector.get<string[] | undefined>(ROLES_KEY, target);
}
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
function permsOf(target: Function) {
  return reflector.get<string[] | undefined>(PERMISSIONS_KEY, target);
}

describe('billing-write routes migrated off @Roles() onto @RequirePermissions', () => {
  it.each([
    [PaymentController.prototype.recordPayment, 'folios.manage'],
    [PaymentController.prototype.authorizePayment, 'folios.manage'],
    [PaymentController.prototype.capturePayment, 'folios.manage'],
    [PaymentController.prototype.voidPayment, 'payments.refund'],
    [PaymentController.prototype.refundPayment, 'payments.refund'],
    [PaymentController.prototype.correctPayment, 'payments.refund'],
    [FolioController.prototype.createFolio, 'folios.manage'],
    [FolioController.prototype.settleFolio, 'folios.manage'],
    [FolioController.prototype.postCharge, 'folios.manage'],
    [NotificationsController.prototype.sendSms, 'communications.manage'],
    [HouseAccountController.prototype.openHouseAccount, 'houseaccounts.manage'],
    [HouseAccountController.prototype.addPayment, 'houseaccounts.manage'],
    [CashierController.prototype.createDrawer, 'cashier.access'],
    [CashierController.prototype.closeSession, 'cashier.access'],
    [AccountingController.prototype.recordDeposit, 'accounting.manage'],
    [AccountingController.prototype.refundDeposit, 'payments.refund'],
    [AccountingController.prototype.createArLedger, 'accounting.manage'],
    [AccountingController.prototype.createAccountingCode, 'accounting.manage'],
  ])('%s: no leftover @Roles, gated on @RequirePermissions(%s)', (method, expectedKey) => {
    expect(rolesOf(method)).toBeUndefined();
    expect(permsOf(method)).toEqual([expectedKey]);
  });

  it('night_auditor can post but cannot refund; accounting / FO / reservations can refund', () => {
    expect(ROLE_DEFAULT_PERMISSIONS.night_auditor).toContain('folios.manage');
    expect(ROLE_DEFAULT_PERMISSIONS.night_auditor).not.toContain('payments.refund');
    for (const role of ['accounting', 'front_desk', 'reservations'] as const) {
      expect(ROLE_DEFAULT_PERMISSIONS[role], role).toContain('payments.refund');
    }
  });
});
