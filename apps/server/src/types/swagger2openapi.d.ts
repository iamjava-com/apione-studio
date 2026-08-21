declare module 'swagger2openapi' {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  export interface ConvertResult {
    openapi: any;
    [key: string]: any;
  }
  export function convertObj(schema: any, options?: any): Promise<ConvertResult>;
  export function convertStr(str: string, options?: any): Promise<ConvertResult>;
}
