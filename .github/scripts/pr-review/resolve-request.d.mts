export function parseRequest(
  eventName: string,
  event: Record<string, unknown>,
): {
  pr: number;
  modelInput: string;
  actor: string;
  association: string;
  source: string;
};

export function catalogModels(
  entries: Array<Record<string, unknown>>,
  config: Record<string, unknown>,
): Array<Record<string, unknown>>;

export function loadCatalog(args: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;

export function normalizeModel(
  input: string,
  config: Record<string, unknown>,
  models: Array<Record<string, unknown>>,
): string;

export function resolveRequest(args: Record<string, unknown>): Promise<Record<string, unknown>>;
