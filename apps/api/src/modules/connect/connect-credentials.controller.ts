import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuditActorCtx, type AuditActor } from '../../common/audit/audit-actor';
import { RequirePermissions } from '../auth/permissions.decorator';
import { Roles } from '../auth/roles.decorator';
import { ConnectCredentialsService } from './connect-credentials.service';
import { CreateConnectCredentialDto } from './dto/connect-credential.dto';

@ApiTags('admin')
@Controller('admin/connect/credentials')
@Roles('admin')
export class ConnectCredentialsController {
  constructor(private readonly credentialsService: ConnectCredentialsService) {}

  @Get()
  @RequirePermissions('settings.manage')
  @ApiOperation({ summary: 'List Connect API credentials for a property' })
  @ApiQuery({ name: 'propertyId', required: true, type: String })
  @ApiResponse({ status: 200, description: 'Credential metadata without plaintext keys or hashes' })
  list(@Query('propertyId', new ParseUUIDPipe()) propertyId: string) {
    return this.credentialsService.list(propertyId);
  }

  @Post()
  @RequirePermissions('settings.manage')
  @ApiOperation({ summary: 'Create a Connect API credential; raw key returned once' })
  @ApiQuery({ name: 'propertyId', required: true, type: String })
  @ApiResponse({ status: 201, description: 'Credential metadata plus one-time raw key' })
  create(
    @Query('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Body() dto: CreateConnectCredentialDto,
    @AuditActorCtx() actor: AuditActor,
  ) {
    return this.credentialsService.create(propertyId, dto, actor);
  }

  @Post(':id/rotate')
  @RequirePermissions('settings.manage')
  @ApiOperation({ summary: 'Rotate a Connect API credential; new raw key returned once' })
  @ApiQuery({ name: 'propertyId', required: true, type: String })
  @ApiResponse({ status: 200, description: 'Credential metadata plus one-time raw key' })
  rotate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('propertyId', new ParseUUIDPipe()) propertyId: string,
    @AuditActorCtx() actor: AuditActor,
  ) {
    return this.credentialsService.rotate(id, propertyId, actor);
  }

  @Delete(':id')
  @RequirePermissions('settings.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke a Connect API credential' })
  @ApiQuery({ name: 'propertyId', required: true, type: String })
  @ApiResponse({ status: 200, description: 'Credential revoked' })
  revoke(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('propertyId', new ParseUUIDPipe()) propertyId: string,
    @AuditActorCtx() actor: AuditActor,
  ) {
    return this.credentialsService.revoke(id, propertyId, actor);
  }
}
