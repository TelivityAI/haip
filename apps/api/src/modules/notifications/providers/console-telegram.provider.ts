import { Injectable, Logger } from '@nestjs/common';
import type {
  TelegramMessage,
  TelegramProvider,
  TelegramResult,
} from '../notification-provider.interface';

/**
 * Development/demo Telegram fallback — logs instead of calling Bot API.
 */
@Injectable()
export class ConsoleTelegramProvider implements TelegramProvider {
  readonly name = 'console';
  private readonly logger = new Logger(ConsoleTelegramProvider.name);

  isConfigured(): boolean {
    return true;
  }

  async send(message: TelegramMessage): Promise<TelegramResult> {
    this.logger.log(`[Telegram:console] → ${message.to}: ${message.body}`);
    return {
      sent: false,
      provider: this.name,
      messageId: `console-telegram-${Date.now()}`,
      error: 'No Telegram bot configured — message logged only',
    };
  }
}
