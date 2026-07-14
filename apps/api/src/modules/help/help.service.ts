import { Injectable, NotFoundException } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import { groundExplanation, numericPayload } from '../llm/grounding';
import { getHelpForRoute, listHelpRoutes, normalizeHelpRoute } from './help-content';

@Injectable()
export class HelpService {
  constructor(private readonly llm: LlmService) {}

  getForRoute(route: string) {
    const entry = getHelpForRoute(route);
    if (!entry) {
      throw new NotFoundException(`No help available for route ${route}`);
    }
    return {
      ...entry,
      normalizedRoute: normalizeHelpRoute(route),
      aiAvailable: this.llm.isConfigured(),
    };
  }

  listRoutes() {
    return { routes: listHelpRoutes(), aiAvailable: this.llm.isConfigured() };
  }

  /**
   * Grounded explain over allowlisted numeric screen facts only.
   * Never injects KB text. Returns null when AI is off or ungrounded.
   */
  async explain(route: string, facts: Record<string, unknown> = {}) {
    const entry = getHelpForRoute(route);
    if (!entry) {
      throw new NotFoundException(`No help available for route ${route}`);
    }

    const numbers = (numericPayload(facts) ?? {}) as Record<string, unknown>;
    const result = await this.llm.explain({
      agentType: 'help',
      decisionType: `screen:${normalizeHelpRoute(route)}`,
      numbers,
    });

    if (!result) {
      return { explanation: null, model: null };
    }

    const guarded = groundExplanation(numbers, result);
    if (!guarded.grounded) {
      return { explanation: null, model: null };
    }

    return {
      explanation: {
        rationale: guarded.rationale,
        suggestions: guarded.suggestions,
        model: result.model,
      },
      model: result.model,
    };
  }
}
