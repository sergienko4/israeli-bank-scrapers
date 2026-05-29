/** Dashboard phase result context. */
interface IDashboardState {
  readonly isReady: boolean;
  readonly pageUrl: string;
  readonly trafficPrimed: boolean;
}

export type { IDashboardState };
