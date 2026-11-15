export declare const widgetSupported: boolean;
export interface WidgetSnapshot { coming?: string; people?: string; weather?: string; tv?: string; updatedAt?: number }
export declare function setSnapshot(snapshot: WidgetSnapshot): void;
export declare function widgetCount(): number;
export declare function requestPin(): boolean;
export interface StashrShortcut { id: string; label: string; long?: string; url: string; icon?: "home" | "tv" | "camera" | "money" | "key" }
export declare function setShortcuts(list: StashrShortcut[]): boolean;
