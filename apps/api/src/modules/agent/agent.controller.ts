import {
  Controller,
  Get,
  Put,
  Post,
  Patch,
  Param,
  Body,
  Query,
  Inject,
  ParseUUIDPipe,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { eq, and, desc } from 'drizzle-orm';
import { guestReviews, reservations } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { AgentService } from './agent.service';
import { UpdateAgentConfigDto } from './dto/agent-config.dto';
import { RejectDecisionDto } from './dto/agent-decision.dto';
import { CreateReviewDto, UpdateReviewResponseDto } from './dto/create-review.dto';

@ApiTags('AI Agents')
@Controller('agents')
@Roles('admin')
export class AgentController {
  constructor(
    private readonly agentService: AgentService,
    @Inject(DRIZZLE) private readonly db: any,
  ) {}

  @Get(':propertyId')
  @ApiOperation({ summary: 'List all agents with status for a property' })
  async listAgents(@Param('propertyId', ParseUUIDPipe) propertyId: string) {
    return this.agentService.listAgentStatuses(propertyId);
  }

  @Get(':propertyId/:agentType/config')
  @ApiOperation({ summary: 'Get agent configuration' })
  async getConfig(
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Param('agentType') agentType: string,
  ) {
    return this.agentService.getOrCreateConfig(propertyId, agentType);
  }

  @Put(':propertyId/:agentType/config')
  @ApiOperation({ summary: 'Update agent configuration' })
  async updateConfig(
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Param('agentType') agentType: string,
    @Body() dto: UpdateAgentConfigDto,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.agentService.updateConfig(propertyId, agentType, dto as any, user?.sub);
  }

  @Post(':propertyId/:agentType/run')
  @ApiOperation({ summary: 'Trigger a manual agent run' })
  async runAgent(
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Param('agentType') agentType: string,
  ) {
    return this.agentService.runAgent(propertyId, agentType, { triggeredBy: 'manual' });
  }

  @Post(':propertyId/:agentType/train')
  @ApiOperation({ summary: 'Train an agent on this property history (writes modelState)' })
  async trainAgent(
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Param('agentType') agentType: string,
  ) {
    return this.agentService.trainAgent(propertyId, agentType);
  }

  @Post(':propertyId/train-all')
  @ApiOperation({ summary: 'Train every enabled agent for a property (cron this nightly)' })
  async trainAll(@Param('propertyId', ParseUUIDPipe) propertyId: string) {
    return this.agentService.trainAll(propertyId);
  }

  @Get(':propertyId/:agentType/decisions')
  @ApiOperation({ summary: 'Get decision history for an agent' })
  @ApiQuery({ name: 'limit', required: false })
  async getDecisions(
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Param('agentType') agentType: string,
    @Query('limit') limit?: string,
  ) {
    return this.agentService.getDecisions(
      propertyId,
      agentType,
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  @Post(':propertyId/decisions/:id/approve')
  @ApiOperation({ summary: 'Approve a pending recommendation' })
  async approveDecision(
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.agentService.approveDecision(propertyId, id, user?.sub);
  }

  @Post(':propertyId/decisions/:id/reject')
  @ApiOperation({ summary: 'Reject a pending recommendation' })
  async rejectDecision(
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectDecisionDto,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.agentService.rejectDecision(propertyId, id, user?.sub, dto.reason);
  }

  @Post(':propertyId/decisions/:id/explain')
  @ApiOperation({
    summary: 'HAIP AI: grounded plain-language rationale + suggestions for a decision',
  })
  @ApiResponse({ status: 201, description: 'Explanation (or {explanation:null} if the model is off)' })
  @ApiQuery({ name: 'force', required: false, description: 'Regenerate even if cached' })
  async explainDecision(
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('force') force?: string,
  ) {
    return this.agentService.explainDecision(propertyId, id, force === 'true');
  }

  @Get(':propertyId/:agentType/performance')
  @ApiOperation({ summary: 'Get agent performance metrics' })
  async getPerformance(
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Param('agentType') agentType: string,
  ) {
    return this.agentService.getPerformance(propertyId, agentType);
  }

  // --- Guest Reviews ---

  @Post(':propertyId/reviews')
  @ApiOperation({ summary: 'Submit a guest review for AI response drafting' })
  @Roles('admin', 'front_desk')
  async createReview(
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: CreateReviewDto,
  ) {
    // FK ownership (security audit follow-on): caller-supplied reservationId
    // must belong to this propertyId. Without this, a review could be attached
    // to a foreign tenant's reservation (cross-tenant FK write into guest_reviews).
    if (dto.reservationId) {
      const [r] = await this.db
        .select({ id: reservations.id })
        .from(reservations)
        .where(and(eq(reservations.id, dto.reservationId), eq(reservations.propertyId, propertyId)));
      if (!r) {
        throw new BadRequestException(`reservation ${dto.reservationId} not found in this property`);
      }
    }
    const [review] = await this.db
      .insert(guestReviews)
      .values({
        propertyId,
        source: dto.source as any,
        guestName: dto.guestName,
        rating: dto.rating,
        reviewText: dto.reviewText,
        stayDate: dto.stayDate ?? null,
        reservationId: dto.reservationId ?? null,
      })
      .returning();

    // Auto-trigger review response agent
    await this.agentService.runAgent(propertyId, 'review_response', {
      triggeredBy: 'event',
      eventPayload: { reviewId: review.id },
    });

    return review;
  }

  @Get(':propertyId/reviews')
  @ApiOperation({ summary: 'List guest reviews for a property' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'source', required: false })
  @Roles('admin', 'front_desk')
  async listReviews(
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Query('status') status?: string,
    @Query('source') source?: string,
  ) {
    const conditions = [eq(guestReviews.propertyId, propertyId)];
    if (status) conditions.push(eq(guestReviews.responseStatus, status as any));
    if (source) conditions.push(eq(guestReviews.source, source as any));

    return this.db
      .select()
      .from(guestReviews)
      .where(and(...conditions))
      .orderBy(desc(guestReviews.createdAt));
  }

  @Patch(':propertyId/reviews/:id')
  @ApiOperation({ summary: 'Update review response (edit, approve, mark posted)' })
  @Roles('admin', 'front_desk')
  async updateReview(
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReviewResponseDto,
  ) {
    const setValues: Record<string, unknown> = {};
    if (dto.responseText !== undefined) setValues['responseText'] = dto.responseText;
    if (dto.responseStatus !== undefined) {
      setValues['responseStatus'] = dto.responseStatus;
      if (dto.responseStatus === 'posted') {
        setValues['respondedAt'] = new Date();
      }
    }

    const [updated] = await this.db
      .update(guestReviews)
      .set(setValues)
      .where(and(eq(guestReviews.id, id), eq(guestReviews.propertyId, propertyId)))
      .returning();

    return updated;
  }
}
