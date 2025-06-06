import { Request, Response, NextFunction } from 'express';
import asyncHandler from 'express-async-handler';
import { ParamsDictionary } from 'express-serve-static-core';

/**
 * A simple wrapper around express-async-handler that properly handles the void return type
 * for Express route handlers with TypeScript
 */
const expressAsyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) => {
  return asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    // Just invoking the function and letting asyncHandler do its job
    await fn(req, res, next);
  });
};

export default expressAsyncHandler;
