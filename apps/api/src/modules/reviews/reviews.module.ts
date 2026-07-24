import { Module } from '@nestjs/common';
import { REVIEW_SOURCE_PROVIDERS } from './review-source.interface';
import { GoogleReviewsProvider } from './providers/google-reviews.provider';
import { TripadvisorReviewsProvider } from './providers/tripadvisor-reviews.provider';
import { ConsoleReviewsProvider } from './providers/console-reviews.provider';
import {
  NamedConsoleReviewsProvider,
  WAVE_REVIEW_CONSOLE_PACKS,
} from './providers/named-console-reviews.provider';
import { ReviewsService } from './reviews.service';
import { ReviewsController } from './reviews.controller';

const WAVE_REVIEW_TOKENS = WAVE_REVIEW_CONSOLE_PACKS.map(
  (pack) => Symbol(`WAVE_REVIEW_${pack.key}`),
);

const waveReviewProviders = WAVE_REVIEW_CONSOLE_PACKS.map((pack, index) => ({
  provide: WAVE_REVIEW_TOKENS[index]!,
  useFactory: () => new NamedConsoleReviewsProvider(pack.key, pack.label),
}));

@Module({
  controllers: [ReviewsController],
  providers: [
    GoogleReviewsProvider,
    TripadvisorReviewsProvider,
    ConsoleReviewsProvider,
    ...waveReviewProviders,
    {
      provide: REVIEW_SOURCE_PROVIDERS,
      inject: [
        GoogleReviewsProvider,
        TripadvisorReviewsProvider,
        ConsoleReviewsProvider,
        ...WAVE_REVIEW_TOKENS,
      ],
      useFactory: (
        google: GoogleReviewsProvider,
        tripadvisor: TripadvisorReviewsProvider,
        consoleProvider: ConsoleReviewsProvider,
        ...wave: NamedConsoleReviewsProvider[]
      ) => [google, tripadvisor, ...wave, consoleProvider],
    },
    ReviewsService,
  ],
  exports: [ReviewsService],
})
export class ReviewsModule {}
