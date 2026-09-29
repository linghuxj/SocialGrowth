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
  setHeader(name: string, value: string): void;
  status(code: number): { json(body: ProductErrorResponse): void };
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

  const frameworkStatus = exception instanceof HttpException ? exception.getStatus() : 500;
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
    const mapped = mapProductException(exception);
    response.setHeader("Cache-Control", "no-store");
    response.status(mapped.status).json(mapped.body);
  }
}
