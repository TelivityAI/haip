import { describe, it, expect } from 'vitest';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';
import { PERMISSIONS_KEY } from './permissions.decorator';
import { ReservationController } from '../reservation/reservation.controller';
import { GuestController } from '../guest/guest.controller';
import { RatePlanController } from '../rate-plan/rate-plan.controller';
import { TaxController } from '../tax/tax.controller';
import { NightAuditController } from '../night-audit/night-audit.controller';
import { AccountingExportController } from '../accounting-export/accounting-export.controller';
import { ReviewsController } from '../reviews/reviews.controller';
import { AgentController } from '../agent/agent.controller';
import { ChannelController } from '../channel/channel.controller';
import { RoomController } from '../room/room.controller';
import { PolicyController } from '../policy/policy.controller';
import { AncillaryController } from '../ancillary/ancillary.controller';
import { HousekeepingController } from '../housekeeping/housekeeping.controller';
import { ServiceRequestsController } from '../service-requests/service-requests.controller';
import { LostAndFoundController } from '../lost-and-found/lost-and-found.controller';
import { DoorLockController } from '../door-lock/door-lock.controller';
import { FolioController } from '../folio/folio.controller';

/**
 * 18 controllers still gated exclusively by the legacy @Roles() decorator
 * (checks the Keycloak realm_access.roles claim against a hardcoded
 * per-endpoint list), while @RequirePermissions() (this same PR's target --
 * local, per-property, DB-backed grants) already governed everything else.
 *
 * The practical bug this fixes: a property-scoped custom role (any role
 * created through the Roles admin screen, not one of the built-in system
 * roles) has no Keycloak realm role at all, so @Roles() can never admit it
 * to any of these 18 controllers no matter what local permissions it holds.
 * A self-hoster who creates a custom role for, say, a seasonal front-desk
 * variant hits this immediately -- the route silently behaves as if the
 * role has zero access, with no way to grant it more.
 *
 * @RequirePermissions() was already the real, sole gate on several of these
 * routes (stacked alongside a now-redundant @Roles() -- @Roles() excluded
 * nothing @RequirePermissions() didn't already exclude, or excluded a role
 * @RequirePermissions() would have admitted, which was itself part of the
 * same bug). Those sites needed only the dead @Roles() line removed. Where
 * no @RequirePermissions() existed yet, the swap uses the pre-existing
 * catalog key whose grantee set in ROLE_DEFAULT_PERMISSIONS is verified
 * identical to the old realm-role list for that route -- confirmed against
 * both the role-set and the route's actual HTTP verb, since several
 * candidate role-lists mix a read-tier role (e.g. plain 'housekeeping')
 * with a write-tier one ('housekeeping_manager'); the only key held by the
 * whole set is then the read key even on a POST/PATCH/DELETE route, and
 * that key is the wrong one to reuse.
 *
 * Left out of this PR, on the same audit: a handful of admin-only routes
 * (property config, iCal sync, media, imports, integrations, connect
 * credentials, booking-engine admin) where the only catalog keys with a
 * matching grantee set are admin.users.manage / admin.roles.manage --
 * semantically wrong for those routes, and no live bug today since 'admin'
 * still holds a real Keycloak realm role. That set needs a dedicated
 * permission key, which is a separate, smaller follow-up.
 */
const reflector = new Reflector();

// Reflector.get's target is a method reference or a class constructor --
// both are plain `Function` in Nest's own guard code (context.getHandler() /
// context.getClass()). No narrower structural type covers both.
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
function rolesOf(target: Function) {
  return reflector.get<string[] | undefined>(ROLES_KEY, target);
}
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
function permsOf(target: Function) {
  return reflector.get<string[] | undefined>(PERMISSIONS_KEY, target);
}

describe('legacy @Roles() controllers migrated to @RequirePermissions()', () => {
  it.each([
    [ReservationController.prototype.searchAvailability, 'reservations.read'],
    [GuestController.prototype.createGuest, 'guests.write'],
    [GuestController.prototype.updateGuest, 'guests.write'],
    [GuestController.prototype.deleteGuest, 'guests.write'],
    [RatePlanController.prototype.createRatePlan, 'rateplans.manage'],
    [RatePlanController.prototype.updateRatePlan, 'rateplans.manage'],
    [TaxController.prototype.createProfile, 'tax.manage'],
    [NightAuditController.prototype.runAudit, 'nightaudit.run'],
    [ReviewsController.prototype.pull, 'reviews.manage'],
    [AgentController.prototype.createReview, 'reviews.manage'],
    [RoomController.prototype.createRoom, 'ops.manage'],
    [RoomController.prototype.updateRoomStatus, 'ops.manage'],
    [FolioController.prototype.listFolios, 'folios.read'],
  ])('%s carries only @RequirePermissions, no leftover @Roles', (method, expectedKey) => {
    expect(rolesOf(method)).toBeUndefined();
    expect(permsOf(method)).toEqual([expectedKey]);
  });

  it('AgentController class-level gate is revenue.manage (AI agent config/training/orchestration)', () => {
    expect(rolesOf(AgentController)).toBeUndefined();
    expect(permsOf(AgentController)).toEqual(['revenue.manage']);
  });

  it('ChannelController class-level gate is channels.manage', () => {
    expect(rolesOf(ChannelController)).toBeUndefined();
    expect(permsOf(ChannelController)).toEqual(['channels.manage']);
  });

  it.each([
    [HousekeepingController.prototype.generateStayoverTasks, 'housekeeping.manage'],
    [HousekeepingController.prototype.deleteTask, 'housekeeping.manage'],
    [ServiceRequestsController.prototype.create, 'ops.manage'],
    [ServiceRequestsController.prototype.update, 'ops.manage'],
    [ServiceRequestsController.prototype.createTask, 'ops.manage'],
    [ServiceRequestsController.prototype.delete, 'ops.manage'],
    [LostAndFoundController.prototype.create, 'ops.manage'],
    [LostAndFoundController.prototype.update, 'ops.manage'],
    [LostAndFoundController.prototype.delete, 'ops.manage'],
    [DoorLockController.prototype.reissue, 'frontdesk.access'],
    [PolicyController.prototype.create, 'policies.manage'],
    [PolicyController.prototype.update, 'policies.manage'],
    [PolicyController.prototype.remove, 'policies.manage'],
    [AncillaryController.prototype.createService, 'services.manage'],
  ])('%s: dead @Roles removed, the unchanged @RequirePermissions(%s) was already the real gate', (method, expectedKey) => {
    expect(rolesOf(method)).toBeUndefined();
    expect(permsOf(method)).toEqual([expectedKey]);
  });

  it('AccountingExportController class-level @Roles removed -- reports.view (per-route) was already the documented intent', () => {
    expect(rolesOf(AccountingExportController)).toBeUndefined();
    expect(permsOf(AccountingExportController.prototype.revenueJournal)).toEqual(['reports.view']);
    expect(permsOf(AccountingExportController.prototype.trialBalance)).toEqual(['reports.view']);
  });

  it('room.controller.ts setHkObservation kept its unchanged @RequirePermissions after the dead @Roles was removed', () => {
    expect(rolesOf(RoomController.prototype.setHkObservation)).toBeUndefined();
    expect(permsOf(RoomController.prototype.setHkObservation)).toEqual(['ops.manage']);
  });
});
