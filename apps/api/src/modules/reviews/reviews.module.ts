import { Module } from '@nestjs/common';
import { REVIEW_SOURCE_PROVIDERS } from './review-source.interface';
import { GoogleReviewsProvider } from './providers/google-reviews.provider';
import { TripadvisorReviewsProvider } from './providers/tripadvisor-reviews.provider';
import { ConsoleReviewsProvider } from './providers/console-reviews.provider';
import { ReviewsService } from './reviews.service';
import { ReviewsController } from './reviews.controller';

@Module({
  controllers: [ReviewsController],
  providers: [
    GoogleReviewsProvider,
    TripadvisorReviewsProvider,
    ConsoleReviewsProvider,
    {
      provide: REVIEW_SOURCE_PROVIDERS,
      inject: [GoogleReviewsProvider, TripadvisorReviewsProvider, ConsoleReviewsProvider],
      useFactory: (
        google: GoogleReviewsProvider,
        tripadvisor: TripadvisorReviewsProvider,
        consoleProvider: ConsoleReviewsProvider,
      ) => [google, tripadvisor, consoleProvider],
    },
    ReviewsService,
  ],
  exports: [ReviewsService],
})
export class ReviewsModule {}
