export declare const widgetSupported: boolean;
export interface WidgetSnapshot { coming?: string; people?: string; weather?: string; tv?: string; updatedAt?: number }
export declare function setSnapshot(snapshot: WidgetSnapshot): void;
export declare function widgetCount(): number;
export declare function requestPin(): boolean;
export interface StashrShortcut { id: string; label: string; long?: string; url: string; icon?: "home" | "tv" | "camera" | "money" | "key" }
export declare function setShortcuts(list: StashrShortcut[]): boolean;
export interface WidgetCounts { home: number; scenes: number; tv: number; quick: number; money: number; net: number; search?: number }
export declare function widgetCounts(): WidgetCounts;
export declare function actionKey(): string;
export declare function pinShortcut(s: { id: string; label: string; url: string; icon?: "home" | "tv" | "camera" | "money" | "key" | "lock" }): boolean;
export declare function setLiveConfig(key: string, servers: string[]): boolean;
export declare function startLive(): boolean;
export declare function stopLive(): void;
export declare function liveInfo(): { hasKey: boolean; bad: boolean };
export declare function setLiveServers(servers: string[]): boolean;
