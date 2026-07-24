// Modified by inHotel Sàrl for inPMS; see NOTICE for upstream provenance.
import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { eq, and, inArray } from 'drizzle-orm';
import { guestReviews, reservations, roomTypes, properties } from '@inhotel-io/database';
import { DRIZZLE } from '../../../database/database.module';
import { AgentService } from '../agent.service';
import type {
  HaipAgent,
  AgentContext,
  AgentAnalysis,
  AgentDecisionInput,
  AgentDecisionRecord,
  ExecutionResult,
  AgentOutcome,
  TrainingResult,
} from '../interfaces/haip-agent.interface';
import {
  analyzeReview,
  generateResponseDraft,
  getDefaultReviewResponseConfig,
  type ReviewResponseConfig,
} from './review-response.models';

@Injectable()
export class ReviewResponseAgent implements HaipAgent, OnModuleInit {
  readonly agentType = 'review_response';

  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly agentService: AgentService,
  ) {}

  onModuleInit() {
    this.agentService.registerAgent(this);
  }

  async analyze(propertyId: string, context?: AgentContext): Promise<AgentAnalysis> {
    const reviewId = context?.eventPayload?.['reviewId'] as string | undefined;

    // Get property info
    const [property] = await this.db
      .select()
      .from(properties)
      .where(eq(properties.id, propertyId));

    // Get agent config
    const config = await this.agentService.getOrCreateConfig(propertyId, this.agentType);
    const reviewConfig: ReviewResponseConfig = {
      ...getDefaultReviewResponseConfig(),
      ...(config.config as object),
      propertyName: property?.name,
    };

    // Get pending reviews
    let pendingReviews: any[];
    if (reviewId) {
      pendingReviews = await this.db
        .select()
        .from(guestReviews)
        .where(
          and(
            eq(guestReviews.id, reviewId),
            eq(guestReviews.propertyId, propertyId),
          ),
        );
    } else {
      pendingReviews = await this.db
        .select()
        .from(guestReviews)
        .where(
          and(
            eq(guestReviews.propertyId, propertyId),
            eq(guestReviews.responseStatus, 'pending' as any),
          ),
        );
    }

    // Get stay details for matched reviews — bulk load to avoid N+1
    const resIds = [...new Set(pendingReviews.map((r: any) => r.reservationId).filter(Boolean))];
    const stayDetailsMap = new Map<string, { roomType?: string; nights?: number }>();

    if (resIds.length > 0) {
      const resData = await this.db
        .select()
        .from(reservations)
        .where(inArray(reservations.id, resIds as any));

      const rtIds = [...new Set(resData.map((r: any) => r.roomTypeId).filter(Boolean))];
      const rtData: any[] = rtIds.length > 0
        ? await this.db.select().from(roomTypes).where(inArray(roomTypes.id, rtIds as any))
        : [];
      const rtMap = new Map(rtData.map((rt: any) => [rt.id, rt]));

      for (const res of resData) {
        const rt = res.roomTypeId ? rtMap.get(res.roomTypeId) : undefined;
        stayDetailsMap.set(res.id, {
          roomType: rt?.name,
          nights: res.nights,
        });
      }
    }

    return {
      agentType: this.agentType,
      propertyId,
      timestamp: new Date(),
      signals: {
        pendingReviews,
        stayDetailsMap: Object.fromEntries(stayDetailsMap),
        reviewConfig,
      },
    };
  }

  async recommend(analysis: AgentAnalysis): Promise<AgentDecisionInput[]> {
    const { pendingReviews, stayDetailsMap, reviewConfig } = analysis.signals as any;

    if (!pendingReviews || pendingReviews.length === 0) return [];

    const decisions: AgentDecisionInput[] = [];

    for (const review of pendingReviews) {
      const stayDetails = review.reservationId ? stayDetailsMap[review.reservationId] : undefined;

      const reviewAnalysis = analyzeReview(review.rating, review.reviewText);
      const draft = generateResponseDraft(
        review.rating,
        review.reviewText,
        review.guestName,
        reviewConfig,
        stayDetails,
      );

      decisions.push({
        decisionType: 'review_response',
        recommendation: {
          reviewId: review.id,
          guestName: review.guestName,
          rating: review.rating,
          source: review.source,
          sentiment: reviewAnalysis.sentiment,
          topics: reviewAnalysis.topics,
          urgency: reviewAnalysis.urgency,
          responseText: draft.responseText,
          tone: draft.tone,
          keyPointsAddressed: draft.keyPointsAddressed,
          hasStayMatch: !!review.reservationId,
        },
        confidence: draft.confidence,
        inputSnapshot: {
          reviewId: review.id,
          rating: review.rating,
          reviewSnippet: review.reviewText.slice(0, 200),
          topicsDetected: reviewAnalysis.topics,
          analyzedAt: analysis.timestamp.toISOString(),
        },
      });
    }

    return decisions;
  }

  async execute(decision: AgentDecisionRecord): Promise<ExecutionResult> {
    const rec = decision.recommendation as any;

    // Update review with drafted response
    await this.db
      .update(guestReviews)
      .set({
        responseStatus: 'drafted',
        responseText: rec.responseText,
      })
      .where(eq(guestReviews.id, rec.reviewId));

    return {
      success: true,
      changes: [{
        entity: 'guest_review',
        action: 'response_drafted',
        detail: `Response drafted for ${rec.guestName}'s ${rec.rating}-star ${rec.source} review`,
      }],
    };
  }

  async recordOutcome(_decisionId: string, _outcome: AgentOutcome): Promise<void> {}

  async train(_propertyId: string): Promise<TrainingResult> {
    return { success: true, dataPoints: 0, modelVersion: 'review-response-v1', metrics: {} };
  }

  getDefaultConfig(): Record<string, unknown> {
    return getDefaultReviewResponseConfig() as unknown as Record<string, unknown>;
  }
}
