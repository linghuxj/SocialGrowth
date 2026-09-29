import {
  ArgumentsHost,
  Catch,
  HttpException,
  type ExceptionFilter,
} from "@nestjs/common";
import {
  contractVersion,
  productErrorResponseSchema,
  type ProductErrorResponse,
} from "@socialgrowth/product-contracts";
import { randomUUID } from "node:crypto";

interface FilterResponse {
  headersSent?: boolean;
  writableEnded?: boolean;
  setHeader(name: string, value: string): void;
  status(code: number): { json(body: ProductErrorResponse): void };
}

function statusFrom(exception: unknown): number {
  if (exception instanceof HttpException) return exception.getStatus();
  if (typeof exception !== "object" || exception === null) return 500;
  for (const property of ["status", "statusCode"] as const) {
    const value = exception[property as keyof typeof exception];
    if (typeof value === "number" && Number.isInteger(value) && value >= 400 && value <= 499) {
      return value;
    }
  }
  return 500;
}

export function mapProductException(exception: unknown): {
  body: ProductErrorResponse;
  status: number;
} {
  if (exception instanceof HttpException) {
    const productResponse = productErrorResponseSchema.safeParse(exception.getResponse());
    if (productResponse.success) {
      return { body: productResponse.data, status: exception.getStatus() };
    }
  }

  const frameworkStatus = statusFrom(exception);
  const internal = frameworkStatus >= 500;
  return {
    status: frameworkStatus,
    body: {
      contractVersion,
      requestId: `request-${randomUUID()}`,
      error: {
        code: internal ? "INTERNAL_ERROR" : "INPUT_INVALID",
        message: internal
          ? "The service could not complete the request"
          : "The request could not be processed",
        retryable: internal,
      },
    },
  };
}

@Catch()
export class ProductExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<FilterResponse>();
    if (response.headersSent || response.writableEnded) return;
    const mapped = mapProductException(exception);
    response.setHeader("Cache-Control", "no-store");
    response.status(mapped.status).json(mapped.body);
  }
}
