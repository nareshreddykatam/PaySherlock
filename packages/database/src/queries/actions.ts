import type { Action, Database } from "../client.js";

export interface GetActionByIdParams {
  id: string;
  merchantId: string;
}

export async function getActionById(
  db: Database,
  params: GetActionByIdParams,
): Promise<Action | null> {
  return db.action.findFirst({ where: { id: params.id, merchantId: params.merchantId } });
}
