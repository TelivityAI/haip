import {
  Controller,
  Get,
  Post,
  Body,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ProfessionService } from './profession.service';
import { CreateProfessionDto } from './dto/create-profession.dto';
import { SearchProfessionsDto } from './dto/search-professions.dto';

@ApiTags('professions')
@Controller('professions')
export class ProfessionController {
  constructor(private readonly professionService: ProfessionService) {}

  @Get()
  @ApiOperation({ summary: 'Search and list professions/occupations' })
  @ApiResponse({ status: 200, description: 'List of matching professions' })
  searchProfessions(@Query() dto: SearchProfessionsDto) {
    return this.professionService.search(dto);
  }

  @Post()
  @ApiOperation({ summary: 'Create or find an existing profession' })
  @ApiResponse({ status: 201, description: 'Profession created or returned' })
  createProfession(@Body() dto: CreateProfessionDto) {
    return this.professionService.findOrCreate(dto);
  }
}
