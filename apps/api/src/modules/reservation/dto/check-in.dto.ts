import {
  IsOptional,
  IsString,
  IsBoolean,
  IsNumber,
  IsUUID,
  IsDateString,
  IsObject,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CheckInDto {
  // ID verification (required by law — KB 5.5)
  @ApiPropertyOptional({ description: 'ID type: passport, drivers_license, national_id' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  idType?: string;

  @ApiPropertyOptional({ description: 'ID number (will be encrypted at rest)' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  idNumber?: string;

  @ApiPropertyOptional({ description: 'ID issuing country (ISO 3166-1 alpha-2)' })
  @IsOptional()
  @IsString()
  @MaxLength(2)
  idCountry?: string;

  @ApiPropertyOptional({ description: 'ID expiry date' })
  @IsOptional()
  @IsDateString()
  idExpiry?: string;

  // Deposit/incidental authorization (KB: $25-200/night hold)
  @ApiPropertyOptional({ description: 'Skip deposit authorization (VIPs, city ledger guests)' })
  @IsOptional()
  @IsBoolean()
  skipDepositAuth?: boolean;

  @ApiPropertyOptional({ description: 'Override default deposit amount' })
  @IsOptional()
  @IsNumber()
  depositAmount?: number;

  @ApiPropertyOptional({ description: 'Stripe PaymentMethod ID (pm_xxx) from Stripe.js/Elements' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  paymentMethodId?: string;

  @ApiPropertyOptional({ description: 'Tokenized card for deposit auth (NEVER raw card data)' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  gatewayPaymentToken?: string;

  @ApiPropertyOptional({ description: 'Payment gateway provider (e.g., stripe, adyen)' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  gatewayProvider?: string;

  @ApiPropertyOptional({ description: 'Last four digits of card' })
  @IsOptional()
  @IsString()
  @MaxLength(4)
  cardLastFour?: string;

  @ApiPropertyOptional({ description: 'Card brand (visa, mastercard, etc.)' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  cardBrand?: string;

  // Room override (if different from pre-assigned)
  @ApiPropertyOptional({ description: 'Override room assignment at check-in' })
  @IsOptional()
  @IsUUID()
  roomId?: string;

  // Guest preferences captured at desk
  @ApiPropertyOptional({ description: 'Additional requests at check-in' })
  @IsOptional()
  @IsString()
  specialRequests?: string;

  // Registration card acknowledgment
  @ApiPropertyOptional({ description: 'Guest signed registration card' })
  @IsOptional()
  @IsBoolean()
  registrationSigned?: boolean;

  @ApiPropertyOptional({
    description: 'Registration card field values (jurisdiction-configured)',
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  registrationData?: Record<string, unknown>;
}
