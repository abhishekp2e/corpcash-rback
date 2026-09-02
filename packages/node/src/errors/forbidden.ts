export interface ForbiddenResponse {
  statusCode: 403;
  error: "Forbidden";
  message: string;
  reason?: string;
}

export interface UnauthorizedResponse {
  statusCode: 401;
  error: "Unauthorized";
  message: string;
}

export function createForbiddenResponse(
  message = "You do not have permission to perform this action.",
  reason?: string
): ForbiddenResponse {
  return {
    statusCode: 403,
    error: "Forbidden",
    message,
    reason,
  };
}

export function createUnauthorizedResponse(
  message = "Authentication required."
): UnauthorizedResponse {
  return {
    statusCode: 401,
    error: "Unauthorized",
    message,
  };
}
