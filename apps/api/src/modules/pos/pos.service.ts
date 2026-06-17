import { Injectable } from '@nestjs/common';
import { FolioService } from '../folio/folio.service';
import type { CreateChargeDto } from '../folio/dto/create-charge.dto';
import type { PostPosChargeDto } from './dto/post-pos-charge.dto';

/**
 * Point-of-Sale integration — lets an external outlet (restaurant, bar, spa)
 * post a charge to a guest's folio.
 *
 * This is a thin, locked-down door onto the existing FolioService: it does NOT
 * reimplement charge/tax logic. `FolioService.postCharge` already verifies the
 * folio belongs to `propertyId` (multi-tenant scoping) and runs tax calculation,
 * so the POS layer only has to translate the outlet's request and pin the tenant.
 */
@Injectable()
export class PosService {
  constructor(private readonly folioService: FolioService) {}

  async postCharge(propertyId: string, dto: PostPosChargeDto) {
    const charge: CreateChargeDto = {
      propertyId,
      type: dto.type,
      description: dto.reference ? `${dto.description} [POS ref ${dto.reference}]` : dto.description,
      amount: dto.amount,
      currencyCode: dto.currencyCode,
      serviceDate: dto.serviceDate,
    };
    // postCharge scopes the folio lookup by propertyId — a POS key for tenant A
    // cannot post onto tenant B's folio even with a guessed folioId.
    return this.folioService.postCharge(dto.folioId, charge);
  }
}
