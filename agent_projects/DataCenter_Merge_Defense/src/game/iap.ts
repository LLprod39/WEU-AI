import { GameState } from "./types";
import { yandexGamesSdk } from "../sdk/yandexGamesSdk";

export const IAP_NO_ADS_ID = "no_ads";
export const IAP_STARTER_PACK_ID = "starter_pack";
const STARTER_PACK_META_CREDITS = 350;

export interface IapCatalogItem {
  id: string;
  title: string;
  description: string;
  price: string;
  priceCurrencyCode?: string;
}

export interface SyncPurchasesResult {
  applied: number;
}

export interface PurchaseApplyResult {
  ok: boolean;
  message: string;
}

export async function getIapCatalog(): Promise<IapCatalogItem[]> {
  const catalog = await yandexGamesSdk.getPaymentsCatalog();
  return catalog
    .filter((item) => item.id === IAP_NO_ADS_ID || item.id === IAP_STARTER_PACK_ID)
    .map((item) => ({
      id: item.id,
      title: item.title,
      description: item.description,
      price: item.price,
      priceCurrencyCode: item.priceCurrencyCode
    }));
}

export async function syncPendingPurchases(gameState: GameState): Promise<SyncPurchasesResult> {
  const purchases = await yandexGamesSdk.getPurchases();
  let applied = 0;

  for (const purchase of purchases) {
    const changed = await applyPurchaseItem(gameState, purchase.productID, purchase.purchaseToken);
    if (changed) {
      applied += 1;
    }
  }

  return { applied };
}

export async function purchaseAndApply(
  gameState: GameState,
  productId: string
): Promise<PurchaseApplyResult> {
  if (productId === IAP_NO_ADS_ID && gameState.settingsState.noAdsPurchased) {
    return { ok: true, message: "no_ads уже активирован" };
  }

  const purchase = await yandexGamesSdk.purchaseProduct(productId);
  if (!purchase) {
    return { ok: false, message: "Покупка недоступна" };
  }

  const changed = await applyPurchaseItem(gameState, purchase.productID, purchase.purchaseToken);
  if (!changed) {
    return { ok: false, message: "Покупка не применена" };
  }

  if (purchase.productID === IAP_NO_ADS_ID) {
    return { ok: true, message: "no_ads активирован" };
  }

  return { ok: true, message: `Начислено +${STARTER_PACK_META_CREDITS} Meta Credits` };
}

async function applyPurchaseItem(
  gameState: GameState,
  productId: string,
  purchaseToken: string | undefined
): Promise<boolean> {
  if (productId === IAP_NO_ADS_ID) {
    const wasActive = gameState.settingsState.noAdsPurchased;
    gameState.settingsState.noAdsPurchased = true;
    return !wasActive;
  }

  if (productId === IAP_STARTER_PACK_ID) {
    gameState.metaState.metaCredits += STARTER_PACK_META_CREDITS;
    gameState.settingsState.starterPackPurchases += 1;

    if (purchaseToken) {
      await yandexGamesSdk.consumePurchase(purchaseToken);
    }

    return true;
  }

  return false;
}
