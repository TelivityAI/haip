import { describe, it, expect } from 'vitest';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';
import { PERMISSIONS_KEY } from './permissions.decorator';
import { PaymentController } from '../payment/payment.controller';
import { FolioController } from '../folio/folio.controller';
import { NotificationsController } from '../notifications/notifications.controller';
import { HouseAccountController } from '../house-account/house-account.controller';
import { CashierController } from '../cashier/cashier.controller';
import { AccountingController } from '../accounting/accounting.controller';

/**
 * The six billing-adjacent controllers left behind by #340, which migrated
 * eighteen others off the legacy @Roles() decorator. These were deferred
 * because they gated every route -- read and write alike -- with one identical
 * realm-role list, so no existing permission key matched it without either
 * widening or narrowing who could record a payment or post a charge.
 *
 * The rule applied here is to PRESERVE the access the realm-role gate was
 * granting in practice: reservations, night_auditor and accounting keep the
 * billing-write ability the old list already gave them, and the matching
 * ROLE_DEFAULT_PERMISSIONS entries plus migration
 * 0023_billing_write_access_grants.sql backfill the keys for properties that
 * already have RBAC rows.
 *
 * One side effect worth disclosing rather than burying: communications.manage
 * (notifications.controller.ts) is already held by revenue_manager for an
 * unrelated existing route (groups.controller.ts), so reusing that key here
 * also lets revenue_manager send guest SMS/WhatsApp/Telegram messages, which
 * the old gate did not. Reusing the existing key seemed better than inventing
 * a near-duplicate one, but say the word and it can be split.
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
    [PaymentController.prototype.voidPayment, 'folios.manage'],
    [FolioController.prototype.createFolio, 'folios.manage'],
    [FolioController.prototype.settleFolio, 'folios.manage'],
    [FolioController.prototype.postCharge, 'folios.manage'],
    [NotificationsController.prototype.sendSms, 'communications.manage'],
    [HouseAccountController.prototype.openHouseAccount, 'houseaccounts.manage'],
    [HouseAccountController.prototype.addPayment, 'houseaccounts.manage'],
    [CashierController.prototype.createDrawer, 'cashier.access'],
    [CashierController.prototype.closeSession, 'cashier.access'],
    [AccountingController.prototype.recordDeposit, 'accounting.manage'],
    [AccountingController.prototype.createArLedger, 'accounting.manage'],
    [AccountingController.prototype.createAccountingCode, 'accounting.manage'],
  ])('%s: no leftover @Roles, gated on @RequirePermissions(%s)', (method, expectedKey) => {
    expect(rolesOf(method)).toBeUndefined();
    expect(permsOf(method)).toEqual([expectedKey]);
  });
});
