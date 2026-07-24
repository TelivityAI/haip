import { Injectable, Logger } from '@nestjs/common';
import type {
  WhatsAppMessage,
  WhatsAppProvider,
  WhatsAppResult,
} from '../notification-provider.interface';

@Injectable()
export class ConsoleWhatsappProvider implements WhatsAppProvider {
  readonly name = 'console-whatsapp';
  private readonly logger = new Logger(ConsoleWhatsappProvider.name);

  isConfigured(): boolean {
    return true;
  }

  async send(message: WhatsAppMessage): Promise<WhatsAppResult> {
    this.logger.log(
      `[WHATSAPP:console] → ${message.to}: ${message.contentSid ?? message.body ?? '[empty]'}`,
    );
    return {
      sent: false,
      provider: this.name,
      messageId: `console-whatsapp-${Date.now()}`,
      error: 'No WhatsApp provider configured — message logged only',
    };
  }
}
