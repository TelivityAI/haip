import { Injectable, Logger } from '@nestjs/common';
import type {
  TelegramMessage,
  TelegramProvider,
  TelegramResult,
} from '../notification-provider.interface';

/**
 * Telegram Bot API reference adapter for guest notifications.
 *
 * Env: `TELEGRAM_BOT_TOKEN`.
 */
@Injectable()
export class TelegramBotProvider implements TelegramProvider {
  readonly name = 'telegram';
  private readonly logger = new Logger(TelegramBotProvider.name);
  private readonly token?: string;

  constructor() {
    this.token = process.env['TELEGRAM_BOT_TOKEN']?.trim();
    if (!this.isConfigured()) {
      this.logger.log('Telegram bot not configured — guest Telegram will fall back to console');
    }
  }

  isConfigured(): boolean {
    return Boolean(this.token);
  }

  async send(message: TelegramMessage): Promise<TelegramResult> {
    if (!this.token) {
      return { sent: false, provider: this.name, error: 'Telegram bot not configured' };
    }

    const body: Record<string, string> = {
      chat_id: message.to,
      text: message.body,
    };
    if (message.parseMode) body['parse_mode'] = message.parseMode;

    try {
      const response = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      });

      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        result?: { message_id?: number };
        description?: string;
      };

      if (!response.ok || data.ok === false) {
        return {
          sent: false,
          provider: this.name,
          error: data.description ?? `Telegram HTTP ${response.status}`,
        };
      }

      return {
        sent: true,
        provider: this.name,
        messageId: data.result?.message_id != null ? String(data.result.message_id) : undefined,
      };
    } catch (error: any) {
      this.logger.error(`Telegram send failed: ${error.message}`);
      return { sent: false, provider: this.name, error: error.message };
    }
  }
}
