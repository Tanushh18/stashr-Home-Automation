export declare const widgetSupported: boolean;
export interface WidgetSnapshot { coming?: string; people?: string; weather?: string; tv?: string; updatedAt?: number }
export declare function setSnapshot(snapshot: WidgetSnapshot): void;
export declare function widgetCount(): number;
export declare function requestPin(): boolean;
export interface StashrShortcut { id: string; label: string; long?: string; url: string; icon?: "home" | "tv" | "camera" | "money" | "key" }
export declare function setShortcuts(list: StashrShortcut[]): boolean;
export interface WidgetCounts { home: number; scenes: number; tv: number; quick: number; money: number; net: number }
export declare function widgetCounts(): WidgetCounts;
export declare function actionKey(): string;
export declare function pinShortcut(s: { id: string; label: string; url: string; icon?: "home" | "tv" | "camera" | "money" | "key" | "lock" }): boolean;
