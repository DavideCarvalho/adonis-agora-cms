import {
  CmsConflictError,
  CmsError,
  CmsForbiddenError,
  CmsNotFoundError,
  CmsUnauthorizedError,
  CmsValidationError,
} from '../errors.js';

export type RestErrorBody = {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
};

/** Maps the CMS error hierarchy to HTTP status codes. */
export function toRestError(error: unknown): { status: number; body: RestErrorBody } {
  if (error instanceof CmsValidationError) {
    return {
      status: 422,
      body: {
        error: { code: error.code, message: 'Validation failed', fields: error.fields },
      },
    };
  }

  if (error instanceof CmsNotFoundError) {
    return { status: 404, body: { error: { code: error.code, message: error.message } } };
  }

  if (error instanceof CmsUnauthorizedError) {
    return { status: 401, body: { error: { code: error.code, message: error.message } } };
  }

  if (error instanceof CmsForbiddenError) {
    return { status: 403, body: { error: { code: error.code, message: error.message } } };
  }

  if (error instanceof CmsConflictError) {
    return { status: 409, body: { error: { code: error.code, message: error.message } } };
  }

  if (error instanceof CmsError) {
    return { status: 500, body: { error: { code: error.code, message: error.message } } };
  }

  // The client gets a generic answer; whoever runs the app still needs the cause.
  console.error('[cms] unexpected error', error);
  return {
    status: 500,
    body: { error: { code: 'CMS_INTERNAL', message: 'Internal server error' } },
  };
}
