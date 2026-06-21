import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

/**
 * Global exception filter.
 *
 * HttpExceptions keep their intended status + message (already safe). Any other
 * error (DB driver error, Decimal parse, TypeError, …) is logged in full
 * server-side but returned to the client as a generic 500 with no stack, SQL,
 * or internal detail — closes the info-disclosure gap from the security review.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('UnhandledException');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();
    const req = ctx.getRequest();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      res.status(status).json(
        typeof exception.getResponse() === 'string'
          ? { statusCode: status, message: exception.getResponse() }
          : exception.getResponse(),
      );
      return;
    }

    const err = exception as { message?: string; stack?: string };
    this.logger.error(
      `Unhandled error on ${req?.method} ${req?.url}: ${err?.message ?? exception}`,
      err?.stack,
    );
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    });
  }
}
