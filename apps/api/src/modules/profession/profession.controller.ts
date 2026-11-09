import {
  Controller,
  Get,
  Post,
  Body,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/permissions.decorator';
import { ProfessionService } from './profession.service';
import { CreateProfessionDto } from './dto/create-profession.dto';
import { SearchProfessionsDto } from './dto/search-professions.dto';

@ApiTags('professions')
@Controller('professions')
export class ProfessionController {
  constructor(private readonly professionService: ProfessionService) {}

  @Get()
  @ApiOperation({ summary: 'Search the global professions/occupations catalog' })
  @ApiResponse({ status: 200, description: 'List of matching professions' })
  searchProfessions(@Query() dto: SearchProfessionsDto) {
    return this.professionService.search(dto);
  }

  @Post()
  @RequirePermissions('guests.write')
  @ApiOperation({ summary: 'Create or find an existing global profession entry' })
  @ApiResponse({ status: 201, description: 'Profession created or returned' })
  createProfession(@Body() dto: CreateProfessionDto) {
    return this.professionService.findOrCreate(dto);
  }
}
