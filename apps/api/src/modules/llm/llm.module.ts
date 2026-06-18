import { Module } from '@nestjs/common';
import { LlmService } from './llm.service';

/**
 * HAIP AI (local model) access. Exported so any agent/module can request a
 * grounded explanation without depending on the model being present.
 */
@Module({
  providers: [LlmService],
  exports: [LlmService],
})
export class LlmModule {}
